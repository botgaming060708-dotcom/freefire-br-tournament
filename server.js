const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_FILE || 'tournament.db');
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'team',
 status TEXT NOT NULL DEFAULT 'pending',
 team_name TEXT NOT NULL,
 player_ids TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS scores (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 match_name TEXT NOT NULL,
 placement INTEGER NOT NULL DEFAULT 0,
 kills INTEGER NOT NULL DEFAULT 0,
 points INTEGER NOT NULL DEFAULT 0,
 note TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS player_scores (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 player_id TEXT NOT NULL,
 match_name TEXT NOT NULL,
 kills INTEGER NOT NULL DEFAULT 0,
 points INTEGER NOT NULL DEFAULT 0,
 note TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings(key,value) VALUES ('entry_fee','80'),('prize_1','900'),('prize_2','600'),('prize_3','400'),('prize_4','300'),('prize_5','250'),('prize_6','200'),('prize_7','150'),('prize_8','100'),('prize_9','100'),('tournament_title','Free Fire MAX BR Tournament');
`);
const getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const setSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

if (ADMIN_EMAIL && ADMIN_PASSWORD) {
 const existing = db.prepare("SELECT id FROM users WHERE email=?").get(ADMIN_EMAIL);
 if (!existing) {
   db.prepare("INSERT INTO users(name,email,password_hash,role,status,team_name,player_ids) VALUES(?,?,?,?,?,?,?)")
    .run('Tournament Admin', ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 12), 'admin', 'approved', 'Admin', '[]');
   console.log('Initial admin account created from environment variables.');
 }
}
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({limit:'100kb'}));
app.use(express.urlencoded({extended:false}));
app.use(session({
 secret: SESSION_SECRET, resave:false, saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*8}
}));

const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role,status:u.status,teamName:u.team_name,playerIds:JSON.parse(u.player_ids||'[]')});
function auth(req,res,next){ if(!req.session.userId) return res.status(401).json({error:'Please log in.'}); next(); }
function admin(req,res,next){ const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId); if(!u || u.role!=='admin') return res.status(403).json({error:'Admin access required.'}); next(); }
function current(req){return req.session.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;}
function settings(){ const rows=db.prepare('SELECT key,value FROM settings').all(); return Object.fromEntries(rows.map(r=>[r.key,r.value])); }

app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/me',(req,res)=>{const u=current(req); res.json({user:u?safeUser(u):null});});
app.post('/api/register', (req,res)=>{
 const {name,email,password,teamName,playerIds=[]}=req.body||{};
 if(!name||!email||!password||!teamName) return res.status(400).json({error:'Complete all required fields.'});
 if(String(password).length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
 if(!Array.isArray(playerIds) || playerIds.length>4) return res.status(400).json({error:'Enter no more than four player IDs.'});
 try {
  db.prepare('INSERT INTO users(name,email,password_hash,team_name,player_ids,status) VALUES(?,?,?,?,?,?)')
   .run(String(name).trim(),String(email).trim().toLowerCase(),bcrypt.hashSync(String(password),12),String(teamName).trim(),JSON.stringify(playerIds.map(String).filter(x=>x.trim()).slice(0,4)),'pending');
  res.json({message:'Registration submitted. Wait for admin approval before logging in.'});
 } catch(e){res.status(409).json({error:'This email is already registered.'});}
});
app.post('/api/login', (req,res)=>{
 const {email,password}=req.body||{};
 const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());
 if(!u || !bcrypt.compareSync(String(password||''),u.password_hash)) return res.status(401).json({error:'Incorrect email or password.'});
 if(u.status!=='approved') return res.status(403).json({error:u.status==='pending'?'Your registration is waiting for admin approval.':'This account is not approved.'});
 req.session.userId=u.id; res.json({user:safeUser(u)});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/settings',(req,res)=>res.json({settings:settings()}));
app.get('/api/profile',auth,(req,res)=>{
 const u=current(req);
 const scores=db.prepare('SELECT match_name,placement,kills,points,note,created_at FROM scores WHERE user_id=? ORDER BY id DESC').all(u.id);
 const playerScores=db.prepare('SELECT player_id,match_name,kills,points,note,created_at FROM player_scores WHERE user_id=? ORDER BY id DESC').all(u.id);
 res.json({user:safeUser(u),scores,playerScores,totalPoints:scores.reduce((a,s)=>a+s.points,0),settings:settings()});
});
app.get('/api/leaderboard',(req,res)=>{
 const rows=db.prepare(`SELECT u.id,u.team_name,u.player_ids,COALESCE(SUM(s.points),0) total_points,
 COALESCE(SUM(s.kills),0) total_kills, COUNT(s.id) matches
 FROM users u LEFT JOIN scores s ON s.user_id=u.id
 WHERE u.role='team' AND u.status='approved' GROUP BY u.id ORDER BY total_points DESC,total_kills DESC,u.team_name ASC`).all();
 res.json({leaderboard:rows.map((r,i)=>({rank:i+1,teamName:r.team_name,playerIds:JSON.parse(r.player_ids||'[]'),totalPoints:r.total_points,totalKills:r.total_kills,matches:r.matches}))});
});
app.get('/api/admin/teams',auth,admin,(req,res)=>{
 const teams=db.prepare("SELECT id,name,email,team_name,player_ids,status,created_at FROM users WHERE role='team' ORDER BY created_at DESC").all();
 res.json({teams:teams.map(t=>({...t,player_ids:JSON.parse(t.player_ids||'[]')}))});
});
app.post('/api/admin/teams/:id/approve',auth,admin,(req,res)=>{
 const result=db.prepare("UPDATE users SET status='approved' WHERE id=? AND role='team'").run(Number(req.params.id));
 res.json({ok:result.changes>0});
});
app.post('/api/admin/teams/:id/reject',auth,admin,(req,res)=>{
 const result=db.prepare("UPDATE users SET status='rejected' WHERE id=? AND role='team'").run(Number(req.params.id));
 res.json({ok:result.changes>0});
});
app.delete('/api/admin/teams/:id',auth,admin,(req,res)=>{
 const result=db.prepare("DELETE FROM users WHERE id=? AND role='team'").run(Number(req.params.id));
 res.json({ok:result.changes>0});
});
app.post('/api/admin/scores',auth,admin,(req,res)=>{
 const {userId,matchName,placement,kills,points,note=''}=req.body||{};
 if(!userId||!matchName||!Number.isFinite(Number(placement))||!Number.isFinite(Number(kills))||!Number.isFinite(Number(points))) return res.status(400).json({error:'Enter team, match, placement, kills and points.'});
 const team=db.prepare("SELECT id FROM users WHERE id=? AND role='team' AND status='approved'").get(Number(userId));
 if(!team) return res.status(404).json({error:'Approved team not found.'});
 db.prepare('INSERT INTO scores(user_id,match_name,placement,kills,points,note) VALUES(?,?,?,?,?,?)')
 .run(Number(userId),String(matchName).trim(),Math.max(0,Number(placement)),Math.max(0,Number(kills)),Math.max(0,Number(points)),String(note).slice(0,500));
 res.json({ok:true});
});
app.delete('/api/admin/scores/:id',auth,admin,(req,res)=>{
 const result=db.prepare('DELETE FROM scores WHERE id=?').run(Number(req.params.id)); res.json({ok:result.changes>0});
});
app.post('/api/admin/player-scores',auth,admin,(req,res)=>{
 const {userId,playerId,matchName,kills,points,note=''}=req.body||{};
 if(!userId||!playerId||!matchName||!Number.isFinite(Number(kills))||!Number.isFinite(Number(points)))
   return res.status(400).json({error:'Enter team, registered player ID, match, kills and points.'});
 const team=db.prepare("SELECT id,player_ids FROM users WHERE id=? AND role='team' AND status='approved'").get(Number(userId));
 if(!team) return res.status(404).json({error:'Approved team not found.'});
 const ids=JSON.parse(team.player_ids||'[]');
 if(!ids.includes(String(playerId).trim())) return res.status(400).json({error:'Player ID must match one of the selected team registered IDs.'});
 db.prepare('INSERT INTO player_scores(user_id,player_id,match_name,kills,points,note) VALUES(?,?,?,?,?,?)')
 .run(Number(userId),String(playerId).trim(),String(matchName).trim(),Math.max(0,Number(kills)),Math.max(0,Number(points)),String(note).slice(0,500));
 res.json({ok:true});
});
app.delete('/api/admin/player-scores/:id',auth,admin,(req,res)=>{
 const result=db.prepare('DELETE FROM player_scores WHERE id=?').run(Number(req.params.id)); res.json({ok:result.changes>0});
});
app.put('/api/admin/settings',auth,admin,(req,res)=>{
 const allowed=['entry_fee','prize_1','prize_2','prize_3','prize_4','prize_5','prize_6','prize_7','prize_8','prize_9','tournament_title'];
 for(const k of allowed) if(req.body[k]!==undefined) {
  const v=String(req.body[k]).trim();
  if(k!=='tournament_title' && (!/^\d+$/.test(v) || Number(v)>10000000)) return res.status(400).json({error:'Fee and prize values must be whole non-negative numbers.'});
  setSetting.run(k,v.slice(0,100));
 }
 res.json({settings:settings()});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Tournament portal running on port ${PORT}`));

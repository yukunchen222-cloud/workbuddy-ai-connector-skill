'use strict';
// WorkBuddy probes MCP servers with short-lived transports. The model HTTP service
// therefore follows the verified desktop owner process, rather than probe stdin.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { requireExecutables, CONNECTOR } = require('./environment.cjs');
const { root, cnExe } = requireExecutables();
fs.mkdirSync(root, { recursive: true });
function ownerPid() {
  const expected = cnExe.replaceAll("'", "''");
  const script = `$n=${process.ppid}; $wbOwner=0; for($i=0;$i -lt 10 -and $n -gt 0;$i++){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$n); if(!$p){break}; if($p.ExecutablePath -ieq '${expected}'){$wbOwner=$n}; $n=$p.ParentProcessId }; Write-Output $wbOwner`;
  const text = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
  const owner = Number(text.trim()); if (!Number.isInteger(owner) || owner <= 0) throw new Error('desktop_owner_not_found'); return owner;
}
function health() {
  return new Promise(resolve => { const r = http.get('http://127.0.0.1:17781/health', { timeout: 700 }, response => { let text='';response.on('data', x=>text+=x);response.on('end',()=>{try{resolve(JSON.parse(text));}catch{resolve(null);}}); });r.on('error',()=>resolve(null));r.on('timeout',()=>{r.destroy();resolve(null);}); });
}
let launch;
async function ensureServer() {
  const owner = ownerPid(); const h = await health();
  if (h?.ownerPid === owner && h.ready && h.service === CONNECTOR) return;
  if (h) throw new Error('port_in_use_close_and_reopen_workbuddy_normally');
  const child = cp.spawn(process.execPath, [path.join(__dirname, 'bridge.cjs'), '--owner-pid', String(owner)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, detached: true, stdio: 'ignore' });
  child.unref();
  fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'native-launcher', pid: process.pid, ownerPid: owner, childPid: child.pid })+'\n');
}
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  let r;try{r=JSON.parse(line);}catch{return;}if(r.id===undefined)return;
  let result;
  if(r.method==='initialize') {
    launch ||= ensureServer().catch(error => fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),event:'native-launcher-failed',error:error.code||error.message})+'\n'));
    result={protocolVersion:r.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'workbuddy-ai-connector',version:'0.2.0'}};
  } else if(r.method==='tools/list') result={tools:[{name:'workbuddy_ai_connection_status',description:'Check the local WorkBuddy AI model connection status without accessing account secrets.',inputSchema:{type:'object',properties:{}}}]};
  else if(r.method==='tools/call' && r.params?.name==='workbuddy_ai_connection_status') {await launch;result={content:[{type:'text',text:JSON.stringify(await health())}]};}
  else if(r.method==='ping')result={};
  else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Method not found'}})+'\n');return;}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');
});

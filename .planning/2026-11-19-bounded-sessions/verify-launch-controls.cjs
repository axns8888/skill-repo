'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const repo=path.resolve(__dirname,'../..'),dsh=require(path.join(repo,'skills/axns-devflow-ext-autopilot/scripts/dsh-session.cjs'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'axns-launch-controls-')),id='20261120-launch-controls';
const put=(rel,value)=>{const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2));};
put('AGENTS.md','extensions: [autopilot]\nautopilot_config: _plan/prompts/autopilot.json\n');
put('_plan/process/'+id+'/prompt.md','Read-only launch configuration verification. Reply with a brief acknowledgement. Do not use tools, write files, or spawn agents.\n');
const config={version:1,models:{known:{provider:'deepseek-official',model:'deepseek-flash',reasoning:'high'}},launch:{default:{tier:'known',team:{enabled:false}}}};
put('_plan/prompts/autopilot.json',config);
const opts={project:root,id,stage:'P2','dsh-bin':'D:/App/FlyEnv-Data/env/node/node_modules/@deepseek-ai/dsh/lib/bin.js',profile:'headless','prompt-file':'prompt.md'};
const proof={checked_at:new Date().toISOString(),project:root,cases:[]};
for(const team of [{enabled:false},{enabled:true,max_members:3}]){
 config.launch.default.team=team;put('_plan/prompts/autopilot.json',config);
 const {manifest}=dsh.prepare(opts);
 proof.cases.push({team:manifest.team,route:manifest.route,manifest_directory:path.dirname(manifest.patch_file),verification:manifest.verification});
}
fs.writeFileSync(path.join(__dirname,'launch-controls-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));

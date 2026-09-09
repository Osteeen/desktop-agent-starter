import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function synthetic(value,ctx){
 const entries=typeof value==='object'?Object.entries(value):[];
 const names=[...new Set(['default',...entries.map(([k])=>k)])];
 return new vm.SyntheticModule(names,function(){this.setExport('default',value);for(const [k,v] of entries)this.setExport(k,v);},{context:ctx});
}
async function load(file,globals={},dependencies={}){
 const ctx=vm.createContext({console,Buffer,ArrayBuffer,Date,process:{platform:'darwin'},...globals});
 const cache=new Map();
 async function dep(spec,ref){
  if(Object.hasOwn(dependencies,spec)){
   if(!cache.has(spec))cache.set(spec,synthetic(dependencies[spec],ctx));
   return cache.get(spec);
  }
  let full=path.resolve(path.dirname(ref.identifier),spec).replace(/\.js$/,'.ts');
  return module(full);
 }
 async function module(full){
  if(cache.has(full))return cache.get(full);
  const source=stripTypeScriptTypes(fs.readFileSync(full,'utf8'),{mode:'transform'});
  const m=new vm.SourceTextModule(source,{context:ctx,identifier:full,importModuleDynamically:async(spec,ref)=>{
    const d=await dep(spec,ref);if(d.status==='unlinked')await d.link(()=>{throw Error('unexpected dependency')});if(d.status==='linked')await d.evaluate();return d;
  }});
  cache.set(full,m);await m.link(dep);return m;
 }
 const m=await module(path.join(root,file));await m.evaluate();return m.namespace;
}
function clock(){let now=0,id=0;const jobs=new Map();const errors=[];
 const add=(fn,ms,repeat)=>{const k=++id;jobs.set(k,{fn,at:now+ms,repeat});return k};
 return {get now(){return now},get intervals(){return [...jobs.values()].filter(j=>j.repeat).length},errors,
 globals:{setTimeout:(f,n)=>add(f,n,0),clearTimeout:k=>jobs.delete(k),setInterval:(f,n)=>add(f,n,n),clearInterval:k=>jobs.delete(k),Date:class extends Date{static now(){return now}}},
 async advance(ms){const end=now+ms;let guard=0;while(true){
  const pair=[...jobs.entries()].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;
  if(++guard>10000)throw Error('timer runaway');const [key,j]=pair;now=j.at;if(j.repeat)j.at+=j.repeat;else jobs.delete(key);
  try{const p=j.fn();if(p?.catch)p.catch(e=>errors.push(String(e)))}catch(e){errors.push(String(e))}
  await new Promise(setImmediate);
 }now=end;await new Promise(setImmediate);}
 };
}

export {load,clock};

import {cp,mkdir,realpath,lstat} from 'node:fs/promises';
import path, {resolve} from 'node:path';
import os from 'node:os';
const home=process.env.HERMES_HOME || path.join(os.homedir(),'.hermes');
const target=path.join(home,'plugins','hermes-workbench');
await mkdir(target,{recursive:true});
await cp(resolve('dashboard'),resolve(target,'dashboard'),{recursive:true});
await cp(resolve('plugin.yaml'),resolve(target,'plugin.yaml'));
console.log(`Installed Workbench to ${target}. Open /workbench on the authenticated Hermes dashboard.`);

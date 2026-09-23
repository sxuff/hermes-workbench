// Copies only the plugin's runtime files into a Hermes home.
// Usage: node scripts/install.mjs [--hermes-home PATH]   (default: $HERMES_HOME or ~/.hermes)
import {cp,mkdir} from 'node:fs/promises';
import path, {resolve} from 'node:path';
import os from 'node:os';
const flag=process.argv.indexOf('--hermes-home');
const home=flag>0&&process.argv[flag+1]?path.resolve(process.argv[flag+1]):process.env.HERMES_HOME || path.join(os.homedir(),'.hermes');
const target=path.join(home,'plugins','hermes-workbench');
await mkdir(target,{recursive:true});
await cp(resolve('dashboard'),resolve(target,'dashboard'),{recursive:true});
for (const file of ['plugin.yaml','__init__.py','workbench_cli.py']) await cp(resolve(file),resolve(target,file));
await cp(resolve('desktop-web'),resolve(target,'desktop-web'),{recursive:true});
console.log(`Installed Workbench to ${target}. Enable it with \`hermes plugins enable hermes-workbench\`, then run \`hermes workbench\`.`);

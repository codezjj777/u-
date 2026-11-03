import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function buildCore(root=path.dirname(fileURLToPath(import.meta.url))){
  const source=await readFile(path.join(root,'shared/core.mjs'),'utf8');
  const exported=source.match(/export\s*\{([^}]+)\};?\s*$/);if(!exported)throw new Error('共享模块缺少明确导出。');
  const browser=`/* Generated from shared/core.mjs. Run npm run build after editing the source. */\n(() => {\n${source.slice(0,exported.index)}\n globalThis.UStudy=Object.freeze({${exported[1]}});\n})();\n`;
  const target=path.join(root,'dist/core.js');if(await readFile(target,'utf8').catch(()=>null)!==browser)await writeFile(target,browser);
}

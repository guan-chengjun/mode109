// 仅用于开发期分析第三方 GLB 模型的节点结构与朝向，运行: node tools-inspect/parse-glb.mjs <file.glb>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);
// GLB 头: magic(4) version(4) length(4)，随后是 chunk: length(4) type(4) data
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

console.log('file:', file);
console.log('asset:', JSON.stringify(json.asset));
console.log('nodes:', json.nodes?.length, 'meshes:', json.meshes?.length);

const trans = (n) => {
  const parts = [];
  if (n.translation) parts.push('T=' + n.translation.map(v => v.toFixed(3)).join(','));
  if (n.rotation) parts.push('R=' + n.rotation.map(v => v.toFixed(3)).join(','));
  if (n.scale) parts.push('S=' + n.scale.map(v => v.toFixed(3)).join(','));
  return parts.join(' ');
};

const walk = (idx, depth) => {
  const n = json.nodes[idx];
  console.log(' '.repeat(depth * 2) + `#${idx} ${n.name ?? ''} ${trans(n)}` + (n.mesh !== undefined ? ` [mesh:${json.meshes[n.mesh]?.name ?? n.mesh}]` : ''));
  for (const c of n.children ?? []) walk(c, depth + 1);
};
for (const r of json.scenes[json.scene ?? 0].nodes) walk(r, 0);

// 找出名称含 wheel 的节点平移，判断车轴方向；含 light/front/rear 的节点判断车头
const wheels = [];
(json.nodes ?? []).forEach((n, i) => {
  if (/wheel|tire|tyre/i.test(n.name ?? '') && n.translation) wheels.push({ i, name: n.name, t: n.translation });
});
console.log('\nwheels:');
for (const w of wheels) console.log(`  #${w.i} ${w.name}  (${w.t.map(v => v.toFixed(3)).join(', ')})`);

const marks = [];
(json.nodes ?? []).forEach((n, i) => {
  if (/light|head|tail|front|rear|back|bumper/i.test(n.name ?? '')) marks.push({ i, name: n.name, t: n.translation });
});
console.log('\nfront/rear markers:');
for (const m of marks) console.log(`  #${m.i} ${m.name}  ${m.t ? '(' + m.t.map(v => v.toFixed(3)).join(', ') + ')' : ''}`);

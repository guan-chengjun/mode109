// 验证 Ferrari GLB 的朝向修正四元数：使加载后 车头->+Z、车顶->+Y
function rotate(q, v) {
  const [x, y, z, w] = q;
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const u = [x, y, z];
  const t = cross(u, v).map((c, i) => c + w * v[i]);
  return v.map((vi, i) => vi + 2 * cross(u, t)[i]);
}
// 反向 120°：轴 (1,1,1)/sqrt3，四元数 (0.5,0.5,0.5,0.5)
const axis = [1/Math.sqrt(3), 1/Math.sqrt(3), 1/Math.sqrt(3)];
const ang = 2*Math.PI/3;
const q = [Math.sin(ang/2)*axis[0], Math.sin(ang/2)*axis[1], Math.sin(ang/2)*axis[2], Math.cos(ang/2)];
console.log('修正四元数:', q.map(n=>+n.toFixed(5)));
console.log('原世界车头 -Y 修正后:', rotate(q,[0,-1,0]).map(n=>+n.toFixed(4)), '(期望 0,0,1)');
console.log('原世界车顶 +X 修正后:', rotate(q,[1,0,0]).map(n=>+n.toFixed(4)), '(期望 0,1,0)');
console.log('原世界车侧 +Z 修正后:', rotate(q,[0,0,1]).map(n=>+n.toFixed(4)), '(期望 1,0,0)');

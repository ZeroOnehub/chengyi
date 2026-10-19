const assert=require('node:assert/strict');
const fs=require('node:fs');
const G=require('../app/static/workbench/geometry.js');
const THREE=require('../app/static/workbench/vendor/three.min.js');
const fixtures=JSON.parse(fs.readFileSync(0,'utf8'));
for(const {document,stats,samples}of fixtures){
 const rows=G.grid(document),actual=G.stats(document,rows),selected=[0,38,95].flatMap(i=>[0,16,32,64,96].map(j=>rows[i][j]));
 for(const key of Object.keys(stats))assert.ok(Math.abs(actual[key]-stats[key])<1e-9,`${document.cross_section.shape}: ${key}`);
 selected.forEach((value,i)=>assert.ok(Math.abs(value-samples[i])<1e-10));
 const geo=G.buildGeometry(THREE,document,rows),p=geo.attributes.position,idx=geo.index,n=geo.attributes.normal;
 assert.ok(p.count>20000&&idx.count>100000);
 const edges=new Map();let volume=0;
 const point=i=>[p.getX(i),p.getY(i),p.getZ(i)];
 const key=i=>point(i).map(v=>Math.round(v*1e5)).join(',');
 for(let i=0;i<idx.count;i+=3){const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)],keys=ids.map(key);if(new Set(keys).size<3)continue;
  for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3],k=a<b?a+'|'+b:b+'|'+a,edge=edges.get(k)||{count:0,orientation:0};edge.count++;edge.orientation+=a<b?1:-1;edges.set(k,edge);}
  const [a,b,c]=ids.map(point);volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
 }
 for(const edge of edges.values()){assert.equal(edge.count,2,'surface must be closed after welding coincident vertices');assert.equal(edge.orientation,0,'triangle winding must be consistent');}
 assert.ok(volume>0,'outward facing shell must enclose positive volume');
 assert.ok([...n.array].every(Number.isFinite));geo.dispose();
}
console.log(fixtures.length+' geometry fixtures passed');

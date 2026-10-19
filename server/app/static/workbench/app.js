'use strict';
(() => {
const $ = id => document.getElementById(id);
const G=window.PotteryGeometry;
const N = 96, SEGMENTS = 128, STORAGE_KEY = 'taowu-pottery-v1';
const materials = {
 terracotta: { name:'赤陶泥', color:'#af7658', gloss:25, tag:'自然肌理' },
 cream: { name:'象牙白', color:'#e8dcc5', gloss:48, tag:'温润白釉' },
 celadon: { name:'青瓷釉', color:'#8fa69a', gloss:72, tag:'青瓷釉面' },
 blue: { name:'天青釉', color:'#64808e', gloss:75, tag:'天青釉面' },
 brown: { name:'紫砂泥', color:'#735545', gloss:12, tag:'细砂肌理' },
 charcoal: { name:'墨黑釉', color:'#444843', gloss:42, tag:'深色釉面' }
};
const presetHeights = { vase:28, jar:23, bowl:12, cup:22 };
function makeProfile(preset) {
 return Array.from({length:N}, (_, i) => {
  const t=i/(N-1);
  if(preset==='jar') return 1.04+0.77*Math.pow(Math.sin(t*Math.PI),0.75)-0.13*t;
  if(preset==='bowl') return 0.72+1.57*Math.sin(t*Math.PI*0.46);
  if(preset==='cup') return 1.03+0.16*t;
  return 0.85+0.67*Math.exp(-Math.pow((t-0.31)/0.29,2))-0.27*Math.exp(-Math.pow((t-0.82)/0.18,2))+0.10*t;
 });
}
let state = {name:'未命名的陶器', profile:makeProfile('vase'), height:28, material:'terracotta', gloss:25, preset:'vase',...G.extraState({})};
function validateProject(data) {
 if(!data || !Array.isArray(data.profile) || data.profile.length!==N || !data.profile.every(v=>Number.isFinite(v)&&v>=0.32&&v<=2.9) || !Number.isFinite(data.height) || data.height<8 || data.height>40 || !materials[data.material] || !Number.isFinite(data.gloss) || data.gloss<0 || data.gloss>100 || !Object.hasOwn(presetHeights,data.preset)) throw Error('工程文件格式不正确');
 const next={name:typeof data.name==='string'?data.name.slice(0,40):'未命名的陶器',profile:[...data.profile],height:data.height,material:data.material,gloss:data.gloss,preset:data.preset,...G.extraState(data)};
 const stats=G.stats(next);if(stats.min_radius<.14-1e-8||stats.max_radius>2.9+1e-8)throw Error('局部轮廓过薄或超出工作台范围');return next;
}
try {const data=localStorage.getItem(STORAGE_KEY);if(data) state=validateProject(JSON.parse(data));}catch{}
let currentTool='hand', rotating=true, inputMode='mouse', wheelSpeed=30, brushSize=50, strength=45,poseRotation=0,radialGrid;
let undoStack=[],redoStack=[], editStart=null, saveTimer, toastTimer;
let applyingRemote=false, remoteHistory=null;
const changeListeners=new Set();
function capturePose(){poseRotation=(((pottery.rotation.y*180/Math.PI+180)%360)+360)%360-180;}
function notifyChange(){if(!applyingRemote&&window.PotteryWorkbench){capturePose();for(const listener of changeListeners)listener(getDocument());}}
const clone = () => JSON.parse(JSON.stringify(state));
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
function persist(notify=false){clearTimeout(saveTimer);try {localStorage.setItem(STORAGE_KEY,JSON.stringify(state));$('save-status').innerHTML='<i></i>已在本机保存';$('save-status').title='作品已保存在当前浏览器';if(notify)toast('作品已保存在当前浏览器');}catch{$('save-status').textContent='本机存储不可用';if(notify)toast('浏览器无法保存，请导出工程文件');}}
function scheduleSave(){$('save-status').textContent='正在保存…';clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(),650);}
function historyUI(){$('btn-undo').disabled=!(remoteHistory?remoteHistory.undo:undoStack.length);$('btn-redo').disabled=!(remoteHistory?remoteHistory.redo:redoStack.length);}
function beginEdit(){if(!editStart)editStart=clone();}
function commitEdit(){let changed=false;if(editStart&&JSON.stringify(editStart)!==JSON.stringify(state)){undoStack.push(editStart);if(undoStack.length>40)undoStack.shift();redoStack=[];historyUI();scheduleSave();changed=true;}editStart=null;if(changed)notifyChange();}
function record(fn){beginEdit();fn();commitEdit();}
function paintRange(el){const percent=(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100;el.style.background=`linear-gradient(to right,var(--accent) ${percent}%,#e8e5dc ${percent}%)`;}
document.querySelectorAll('input[type=range]').forEach(el=>{paintRange(el);el.addEventListener('input',()=>paintRange(el));});
let renderer,scene,camera,controls,pottery,wheel,brushRing,grid,potMaterial;
const canvas=$('webgl-canvas'), stage=canvas.parentElement;
try {
 if(!window.THREE || !THREE.OrbitControls)throw Error('3D library unavailable');
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
 scene=new THREE.Scene();scene.background=new THREE.Color('#f1eee7');scene.fog=new THREE.Fog('#f1eee7',18,38);
 camera=new THREE.PerspectiveCamera(36,1,0.1,80);
 controls=new THREE.OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.075;controls.enablePan=false;controls.enableRotate=false;controls.minDistance=6;controls.maxDistance=20;controls.minPolarAngle=.025;controls.maxPolarAngle=Math.PI/2-.035;controls.target.set(0,2.05,0);controls.zoomSpeed=.65;
 scene.add(new THREE.HemisphereLight('#fff8e9','#b0a995',.65));scene.add(new THREE.AmbientLight('#f5eada',.15));
 const key=new THREE.DirectionalLight('#fff4e1',1.65);key.position.set(-5,9,6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-6;key.shadow.camera.right=6;key.shadow.camera.top=8;key.shadow.camera.bottom=-6;key.shadow.camera.far=25;key.shadow.bias=-.0004;key.shadow.normalBias=.02;key.shadow.radius=5;scene.add(key);
 const fill=new THREE.DirectionalLight('#f3f6ed',.45);fill.position.set(6,4,-4);scene.add(fill);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:new THREE.Color('#d7d2c7').convertSRGBToLinear(),roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.31;ground.receiveShadow=true;scene.add(ground);
 const base=new THREE.Mesh(new THREE.CylinderGeometry(2.38,2.19,.22,128),new THREE.MeshStandardMaterial({color:'#a8aa9c',metalness:.20,roughness:.66}));base.position.y=-.12;base.castShadow=true;base.receiveShadow=true;scene.add(base);
 wheel=new THREE.Group();scene.add(wheel);
 const wheelTop=new THREE.Mesh(new THREE.CylinderGeometry(2.45,2.45,.13,128),new THREE.MeshStandardMaterial({color:new THREE.Color('#b6b4a2').convertSRGBToLinear(),metalness:.18,roughness:.64}));wheelTop.position.y=.055;wheelTop.castShadow=true;wheelTop.receiveShadow=true;wheel.add(wheelTop);
 for(let i=0;i<11;i++){const r=.35+i*.19;const pts=[];for(let j=0;j<=128;j++){const a=j/128*Math.PI*2;pts.push(new THREE.Vector3(Math.sin(a)*r,.122,Math.cos(a)*r));}const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:'#acae9c',transparent:true,opacity:.33}));wheel.add(line);}
 const wheelDot=new THREE.Mesh(new THREE.SphereGeometry(.025,8,8),new THREE.MeshBasicMaterial({color:'#8d927e'}));wheelDot.position.set(2.29,.13,0);wheel.add(wheelDot);
 const textureCanvas=document.createElement('canvas');textureCanvas.width=512;textureCanvas.height=1024;const ctx=textureCanvas.getContext('2d');
 ctx.fillStyle='#888';ctx.fillRect(0,0,512,1024);let seed=76123;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
 const texData=ctx.getImageData(0,0,512,1024);for(let y=0;y<1024;y++){const wave=Math.sin(y*.83)*3+Math.sin(y*.205)*1.5;for(let x=0;x<512;x++){const n=128+wave+(rand()-.5)*11,ind=(y*512+x)*4;texData.data[ind]=texData.data[ind+1]=texData.data[ind+2]=n;texData.data[ind+3]=255;}}ctx.putImageData(texData,0,0);
 const texture=new THREE.CanvasTexture(textureCanvas);texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 potMaterial=new THREE.MeshStandardMaterial({color:materials[state.material].color,roughness:.75,metalness:0,bumpMap:texture,bumpScale:.026});
 pottery=new THREE.Mesh(new THREE.BufferGeometry(),potMaterial);pottery.position.y=.125;pottery.castShadow=true;pottery.receiveShadow=true;scene.add(pottery);
 brushRing=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#f2d3ae',transparent:true,opacity:.72,depthTest:true}));brushRing.visible=false;scene.add(brushRing);
 grid=new THREE.GridHelper(24,48,'#d4cebc','#ded9ca');grid.position.y=-.295;grid.material.transparent=true;grid.material.opacity=.65;grid.visible=false;scene.add(grid);
}catch(error){console.error(error);$('render-error').hidden=false;$('ready-status').textContent='3D 画布无法启动';return;}
function rebuild(){
 radialGrid=G.grid(state);const old=pottery.geometry;pottery.geometry=G.buildGeometry(THREE,state,radialGrid);old.dispose();updateMeasurements();
}
function updateMeasurements(){const width=G.stats(state,radialGrid).diameter_cm;$('height-stat').innerHTML=`${state.height.toFixed(1)}<small>cm</small>`;$('width-stat').innerHTML=`${width.toFixed(1)}<small>cm</small>`;$('height-value').value=state.height.toFixed(1);}
const outlineParts={whole:[0,1],mouth:[.88,1],upper:[.5,1],middle:[.33,.67],lower:[0,.5]};
function outlineUI(){const [start,end]=outlineParts[$('outline-area').value],s=[...state.section_bands].reverse().find(b=>b.start_height_ratio===start&&b.end_height_ratio===end)||state.cross_section;$('outline-shape').value=s.shape;$('outline-roundness').value=s.roundness*100;$('outline-roundness-value').value=Math.round(s.roundness*100);$('outline-aspect').value=s.aspect_ratio;$('outline-aspect-value').value=s.aspect_ratio.toFixed(1);paintRange($('outline-roundness'));paintRange($('outline-aspect'));$('outline-summary').textContent='整体为'+G.NAMES[state.cross_section.shape]+(state.section_bands.length?'，另有'+state.section_bands.length+'处部位形状':'')+(state.deformations.length?'，'+state.deformations.length+'处单侧调整':'')+'。';}
function materialUI(){const m=materials[state.material];potMaterial.color.set(m.color).convertSRGBToLinear();potMaterial.roughness=.96-state.gloss*.0078;potMaterial.bumpScale=state.material==='brown'?.04:(state.gloss>60?.012:.026);$('material-name').textContent=m.name;$('material-tag').textContent=m.tag;$('roughness').value=state.gloss;$('roughness-value').value=state.gloss;paintRange($('roughness'));document.querySelectorAll('.swatch').forEach(b=>{const active=b.dataset.material===state.material;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function sync(){rebuild();materialUI();outlineUI();$('project-name').value=state.name;$('height').value=state.height;paintRange($('height'));document.querySelectorAll('.preset').forEach(b=>{const active=b.dataset.preset===state.preset;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});historyUI();}
function undo(){commitEdit();if(window.PotteryWorkbench?.onCommand){window.PotteryWorkbench.onCommand('撤销');return;}if(!undoStack.length)return;redoStack.push(clone());state=undoStack.pop();sync();scheduleSave();notifyChange();toast('已撤销上一步操作');}
function redo(){if(window.PotteryWorkbench?.onCommand){window.PotteryWorkbench.onCommand('重做');return;}if(!redoStack.length)return;undoStack.push(clone());state=redoStack.pop();sync();scheduleSave();notifyChange();toast('已恢复上一步操作');}
$('btn-undo').onclick=undo;$('btn-redo').onclick=redo;
const BASE_DISTANCE=11.4;
function setView(view){const target=new THREE.Vector3(0,state.height/12,0);controls.target.copy(target);if(view==='front')camera.position.copy(target).add(new THREE.Vector3(0,.25,BASE_DISTANCE));else if(view==='top')camera.position.copy(target).add(new THREE.Vector3(0,BASE_DISTANCE,.05));else camera.position.copy(target).add(new THREE.Vector3(6.3,4.15,8.55).normalize().multiplyScalar(BASE_DISTANCE));camera.lookAt(target);controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));updateZoom();}
function updateZoom(){$('zoom-value').textContent=`${Math.round(BASE_DISTANCE/camera.position.distanceTo(controls.target)*100)}%`;}
function resize(){const r=stage.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{setView(b.dataset.view);notifyChange();});
$('btn-fit').onclick=()=>{setView('perspective');notifyChange();};
function zoom(multiplier){const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*multiplier,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();updateZoom();}
$('btn-zoom-in').onclick=()=>{zoom(.88);notifyChange();};$('btn-zoom-out').onclick=()=>{zoom(1.12);notifyChange();};controls.addEventListener('change',updateZoom);
let zoomSyncTimer;canvas.addEventListener('wheel',()=>{clearTimeout(zoomSyncTimer);zoomSyncTimer=setTimeout(notifyChange,450);},{passive:true});
$('btn-grid').onclick=()=>{grid.visible=!grid.visible;$('btn-grid').setAttribute('aria-pressed',String(grid.visible));$('btn-grid').style.color=grid.visible?'var(--accent)':'';};
function toggleRotation(){rotating=!rotating;$('btn-toggle-rotate').setAttribute('aria-pressed',String(rotating));$('rotation-label').textContent=rotating?'暂停转盘':'启动转盘';$('btn-toggle-rotate').querySelector('use').setAttribute('href',rotating?'#i-pause':'#i-play');$('wheel-status').textContent=rotating?'转动中':'已暂停';$('wheel-status').style.color=rotating?'':'#a29e90';notifyChange();}
$('btn-toggle-rotate').onclick=toggleRotation;
function setTool(tool){currentTool=tool;document.querySelectorAll('.tool').forEach(b=>{const active=b.dataset.tool===tool;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
document.querySelectorAll('.tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
for(const id of ['brush-size','strength','wheel-speed']){$(id).addEventListener('input',()=>{const v=Number($(id).value);$(id+'-value').value=v;if(id==='brush-size')brushSize=v;if(id==='strength')strength=v;if(id==='wheel-speed')wheelSpeed=v;});}
$('wheel-speed').addEventListener('change',notifyChange);
$('outline-area').onchange=outlineUI;
function changeOutline(values){if(window.PotteryWorkbench?.onTool)window.PotteryWorkbench.onTool('set_cross_section',{part:$('outline-area').value,...values},'调整'+$('outline-area').selectedOptions[0].textContent+'的形状');else{toast('请先连接后台再调整轮廓');outlineUI();}}
$('outline-shape').onchange=()=>changeOutline({shape:$('outline-shape').value});
for(const id of ['outline-roundness','outline-aspect']){$(id).addEventListener('input',()=>{$(id+'-value').value=id==='outline-roundness'?$(id).value:Number($(id).value).toFixed(1);});$(id).onchange=()=>changeOutline(id==='outline-roundness'?{roundness:Number($(id).value)/100}:{aspect_ratio:Number($(id).value)});}
$('btn-outline-top').onclick=()=>{setView('top');notifyChange();};
for(const id of ['height','roughness']){const el=$(id);el.addEventListener('pointerdown',beginEdit);el.addEventListener('input',()=>{beginEdit();if(id==='height'){state.height=Number(el.value);rebuild();}else{state.gloss=Number(el.value);materialUI();}});el.addEventListener('change',commitEdit);el.addEventListener('blur',commitEdit);}
document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>record(()=>{state.material=b.dataset.material;state.gloss=materials[state.material].gloss;materialUI();}));
document.querySelectorAll('.preset').forEach(b=>b.onclick=()=>record(()=>{state.preset=b.dataset.preset;state.profile=makeProfile(state.preset);state.height=presetHeights[state.preset];Object.assign(state,G.extraState({}));sync();setView('perspective');toast('已切换器形，可以通过撤销恢复');}));
$('btn-reset').onclick=()=>$('reset-dialog').showModal();$('close-reset').onclick=$('cancel-reset').onclick=()=>$('reset-dialog').close();
$('confirm-reset').onclick=()=>{record(()=>{state.profile=makeProfile(state.preset);state.height=presetHeights[state.preset];Object.assign(state,G.extraState({}));sync();});$('reset-dialog').close();toast('坯体已重置');};
$('project-name').addEventListener('focus',beginEdit);$('project-name').addEventListener('input',()=>{state.name=$('project-name').value;scheduleSave();});$('project-name').addEventListener('change',()=>{state.name=state.name.trim()||'未命名的陶器';$('project-name').value=state.name;commitEdit();});$('project-name').addEventListener('blur',commitEdit);
// Sculpt along the radial profile; all rings remain continuous and watertight.
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(),planePoint=new THREE.Vector3(),cameraRight=new THREE.Vector3();
let interaction=null;
function setRay(x,y){const r=canvas.getBoundingClientRect();pointer.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
function hitPot(x,y){setRay(x,y);return raycaster.intersectObject(pottery,false)[0];}
function configurePlane(){const normal=camera.getWorldDirection(new THREE.Vector3());normal.y=0;if(normal.lengthSq()<.0001)normal.set(0,0,-1);normal.normalize();plane.setFromNormalAndCoplanarPoint(normal,new THREE.Vector3());cameraRight.setFromMatrixColumn(camera.matrixWorld,0).normalize();}
function getPlanePoint(x,y){setRay(x,y);return raycaster.ray.intersectPlane(plane,planePoint)?planePoint.clone():null;}
function profileAt(y){const t=THREE.MathUtils.clamp((y-pottery.position.y)/(state.height/6),0,1)*(N-1);return state.profile[Math.round(t)];}
function showBrush(y){const local=THREE.MathUtils.clamp(y-pottery.position.y,.025,state.height/6),row=Math.round(local/(state.height/6)*95),points=[];for(let i=0;i<128;i++){const a=i/128*Math.PI*2+pottery.rotation.y,r=radialGrid[Math.min(95,row)][i]+.009;points.push(new THREE.Vector3(Math.sin(a)*r,local+pottery.position.y,Math.cos(a)*r));}const old=brushRing.geometry;brushRing.geometry=new THREE.BufferGeometry().setFromPoints(points);old.dispose();brushRing.visible=true;}
function applySculpt(y,delta){
 const h=state.height/6,local=y-pottery.position.y;if(local<.06||local>h+.05)return;
 const layer=THREE.MathUtils.clamp(local/h,0,1)*(N-1),toolWidth={hand:1,spatula:.5,carve:.11,smooth:.8}[currentTool],sigma=(2+brushSize*.14)*toolWidth,power=strength/45;
 const original=[...state.profile];
 for(let i=1;i<N;i++){const weight=Math.exp(-Math.pow(i-layer,2)/(2*sigma*sigma));if(weight<.002)continue;
  let amount=delta*power*weight;
  if(currentTool==='smooth'){const lo=Math.max(0,i-3),hi=Math.min(N-1,i+3);let total=0;for(let k=lo;k<=hi;k++)total+=original[k];amount=(total/(hi-lo+1)-original[i])*.48*power*weight;}
  if(currentTool==='carve')amount=-.012*power*weight;
  state.profile[i]=THREE.MathUtils.clamp(original[i]+amount,.32,2.9);
 }
 const bounds=G.stats(state);if(bounds.min_radius<.14-1e-8||bounds.max_radius>2.9+1e-8){state.profile=original;return;}rebuild();showBrush(y);
}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0&&e.button!==2)return;canvas.setPointerCapture(e.pointerId);configurePlane();const hit=inputMode==='mouse'&&e.button===0&&!e.shiftKey?hitPot(e.clientX,e.clientY):null;
 if(hit){beginEdit();const p=getPlanePoint(e.clientX,e.clientY);if(!p)return;interaction={kind:'sculpt',point:p,side:Math.sign(hit.point.dot(cameraRight))||1};canvas.style.cursor='ew-resize';showBrush(hit.point.y);$('ready-status').textContent='正在塑形';}
 else{interaction={kind:'orbit',x:e.clientX,y:e.clientY};brushRing.visible=false;canvas.style.cursor='grabbing';}
});
canvas.addEventListener('pointermove',e=>{
 if(!interaction){if(inputMode==='mouse'){const hit=hitPot(e.clientX,e.clientY);canvas.style.cursor=hit?'ew-resize':'grab';if(hit)showBrush(hit.point.y);else brushRing.visible=false;}return;}
 if(interaction.kind==='sculpt'){const p=getPlanePoint(e.clientX,e.clientY);if(!p)return;const delta=p.clone().sub(interaction.point).dot(cameraRight)*interaction.side;applySculpt(p.y,delta);interaction.point=p;}
 else{const dx=e.clientX-interaction.x,dy=e.clientY-interaction.y;const offset=camera.position.clone().sub(controls.target);const sph=new THREE.Spherical().setFromVector3(offset);sph.theta-=dx*.006;sph.phi=THREE.MathUtils.clamp(sph.phi-dy*.006,.025,Math.PI/2-.035);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));camera.lookAt(controls.target);interaction.x=e.clientX;interaction.y=e.clientY;document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));}
});
function finishPointer(){if(interaction?.kind==='sculpt')commitEdit();if(interaction?.kind==='orbit')notifyChange();interaction=null;canvas.style.cursor='grab';brushRing.visible=false;$('ready-status').textContent='工作台已就绪';}
canvas.addEventListener('pointerup',finishPointer);canvas.addEventListener('pointercancel',finishPointer);canvas.addEventListener('lostpointercapture',finishPointer);canvas.addEventListener('pointerleave',()=>{if(!interaction)brushRing.visible=false;});
function download(blob,extension){const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=`${(state.name.trim()||'陶物作品').replace(/[\\/:*?"<>|]/g,'_')}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(href),2000);$('export-menu').hidden=true;$('btn-export-menu').setAttribute('aria-expanded','false');}
$('btn-save').onclick=()=>{commitEdit();if(window.PotteryWorkbench?.onCommand)window.PotteryWorkbench.onCommand('保存作品');else persist(true);};
$('btn-export-menu').onclick=()=>{const open=$('export-menu').hidden;$('export-menu').hidden=!open;$('btn-export-menu').setAttribute('aria-expanded',String(open));};
document.addEventListener('click',e=>{if(!e.target.closest('.export-wrap')){$('export-menu').hidden=true;$('btn-export-menu').setAttribute('aria-expanded','false');}});
$('btn-snapshot').onclick=()=>{const wasVisible=brushRing.visible;brushRing.visible=false;renderer.render(scene,camera);canvas.toBlob(blob=>{if(blob){download(blob,'png');toast('作品图片已导出');}else toast('图片导出失败，请重新尝试');},'image/png');brushRing.visible=wasVisible;};
$('btn-project').onclick=()=>{download(new Blob([JSON.stringify({format:'taowu-pottery',version:2,...getDocument()},null,2)],{type:'application/json'}),'json');toast('工程文件已导出');};
function objBlob(){
 const geo=pottery.geometry,p=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv,idx=geo.index,lines=['# Taowu Studio pottery model','# Units: centimeters','o TaowuPottery'];
 for(let i=0;i<p.count;i++)lines.push(`v ${(p.getX(i)*6).toFixed(5)} ${(p.getY(i)*6).toFixed(5)} ${(p.getZ(i)*6).toFixed(5)}`);
 for(let i=0;i<uv.count;i++)lines.push(`vt ${uv.getX(i).toFixed(6)} ${uv.getY(i).toFixed(6)}`);
 for(let i=0;i<n.count;i++)lines.push(`vn ${n.getX(i).toFixed(6)} ${n.getY(i).toFixed(6)} ${n.getZ(i).toFixed(6)}`);
 for(let i=0;i<idx.count;i+=3){const a=idx.getX(i)+1,b=idx.getX(i+1)+1,c=idx.getX(i+2)+1;lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);}
 return new Blob([lines.join('\n')+'\n'],{type:'text/plain'});
}
$('btn-export').onclick=()=>{download(objBlob(),'obj');toast('3D 模型已导出（单位：厘米）');};
$('btn-import').onclick=()=>{$('project-file').click();$('export-menu').hidden=true;$('btn-export-menu').setAttribute('aria-expanded','false');};
function importedPose(raw){
 const current=getDocument(),wheel={...current.wheel,...raw.wheel},view={...current.view,...raw.view};
 const finite=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
 if(typeof wheel.rotating!=='boolean'||!finite(wheel.speed_rpm,5,60)||!finite(wheel.rotation_deg,-180,180)||!['front','top','perspective','custom'].includes(view.direction)||!finite(view.azimuth_deg,-360,360)||!finite(view.polar_deg,1.43,88)||!finite(view.zoom_percent,57,190))throw Error('工程文件中的转盘或视角参数不正确');
 return {wheel,view};
}
$('project-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw Error('工程文件超过 1 MB');const raw=JSON.parse(await file.text()),next=validateProject(raw),pose=importedPose(raw);commitEdit();const before=clone();applyDocument({...next,...pose});undoStack.push(before);redoStack=[];historyUI();notifyChange();toast('工程文件已打开');}catch(error){toast(error instanceof SyntaxError?'文件无法读取，请选择陶物导出的 JSON 工程文件':error.message);}e.target.value='';};
$('btn-help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=$('help-done').onclick=()=>$('help-dialog').close();
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
document.addEventListener('keydown',e=>{if(e.target.closest('#agent-panel')||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('btn-save').click();return;}if(e.code==='Space'){e.preventDefault();toggleRotation();}const toolKeys={1:'hand',2:'spatula',3:'carve',4:'smooth'};if(toolKeys[e.key])setTool(toolKeys[e.key]);});
// Camera permission is requested only after the user selects gesture input.
let mediaStream=null,hands=null,cameraToken=0,gestureFrame=0,gestureBusy=false,handPrev=null,handPinching=false,handSession=false;
const HANDS_ROOT='https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
function modeUI(mode){inputMode=mode;for(const name of ['mouse','gesture']){const active=name===mode;$('mode-'+name).classList.toggle('active',active);$('mode-'+name).setAttribute('aria-pressed',String(active));}$('mode-hint').textContent=mode==='mouse'?'按住陶泥左右拖动，调整器身轮廓。':'捏合拇指与食指，在器物轮廓处移动。';$('stage-hint').textContent=mode==='mouse'?'在陶泥上拖动，试着改变它的形状':'捏合两指移动进行塑形，松开停止';}
function stopCamera(){cameraToken++;cancelAnimationFrame(gestureFrame);if(mediaStream)mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;$('webcam').srcObject=null;$('camera-panel').hidden=true;handPrev=null;if(handSession)commitEdit();handSession=false;handPinching=false;brushRing.visible=false;modeUI('mouse');}
function loadHandsLibrary(){if(window.Hands)return Promise.resolve();return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=HANDS_ROOT+'hands.js';s.crossOrigin='anonymous';const timer=setTimeout(()=>{s.remove();reject(Error('手势组件加载超时，请检查网络'));},20000);s.onload=()=>{clearTimeout(timer);window.Hands?resolve():reject(Error('手势组件无法加载'));};s.onerror=()=>{clearTimeout(timer);s.remove();reject(Error('手势组件无法加载，请检查网络'));};document.head.appendChild(s);});}
function onHandResults(results){
 if(inputMode!=='gesture')return;const overlay=$('hand-overlay');overlay.width=320;overlay.height=240;const ctx=overlay.getContext('2d');ctx.clearRect(0,0,320,240);
 const landmarks=results.multiHandLandmarks?.[0];if(!landmarks){$('gesture-status').textContent='未检测到手，请将手放入画面';brushRing.visible=false;if(handSession)commitEdit();handSession=false;handPinching=false;handPrev=null;return;}
 const thumb=landmarks[4],index=landmarks[8],wrist=landmarks[0],knuckle=landmarks[9];
 const pinchDistance=Math.hypot(thumb.x-index.x,thumb.y-index.y),palmSize=Math.hypot(wrist.x-knuckle.x,wrist.y-knuckle.y);
 const pinch=pinchDistance/Math.max(.03,palmSize)<(handPinching?.55:.40);handPinching=pinch;
 const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
 ctx.strokeStyle=pinch?'#b56e47':'#89a084';ctx.lineWidth=2;for(const[a,b]of connections){ctx.beginPath();ctx.moveTo(landmarks[a].x*320,landmarks[a].y*240);ctx.lineTo(landmarks[b].x*320,landmarks[b].y*240);ctx.stroke();}ctx.fillStyle='#fff9e9';for(const p of landmarks){ctx.beginPath();ctx.arc(p.x*320,p.y*240,2,0,Math.PI*2);ctx.fill();}
 const rect=canvas.getBoundingClientRect(),sx=rect.left+(1-(index.x+thumb.x)/2)*rect.width,sy=rect.top+(index.y+thumb.y)/2*rect.height;configurePlane();const point=getPlanePoint(sx,sy);if(!point)return;
 const local=point.y-pottery.position.y,radial=Math.abs(point.dot(cameraRight)),near=local>=0&&local<=state.height/6&&Math.abs(radial-profileAt(point.y))<.85;
 if(pinch){if(!handSession&&near){beginEdit();handSession=true;handPrev=point;}$('gesture-status').textContent=handSession?'两指捏合 · 正在塑形':'请在器物轮廓附近捏合两指';if(handSession){if(handPrev)applySculpt(point.y,point.clone().sub(handPrev).dot(cameraRight)*(Math.sign(handPrev.dot(cameraRight))||1));handPrev=point;}}
 else{if(handSession)commitEdit();handSession=false;handPrev=null;brushRing.visible=near;if(near)showBrush(point.y);$('gesture-status').textContent='已检测到手 · 捏合两指开始塑形';}
}
async function startCamera(){if(inputMode==='gesture')return;const token=++cameraToken;modeUI('gesture');$('camera-panel').hidden=false;$('gesture-status').textContent='正在请求摄像头权限…';
 try{if(!navigator.mediaDevices?.getUserMedia)throw Error('当前浏览器无法启用摄像头，请使用安全连接');const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});if(token!==cameraToken){stream.getTracks().forEach(t=>t.stop());return;}mediaStream=stream;$('webcam').srcObject=stream;await $('webcam').play();$('gesture-status').textContent='正在加载手势识别组件…';await loadHandsLibrary();if(token!==cameraToken)return;if(!hands){hands=new window.Hands({locateFile:file=>HANDS_ROOT+file});hands.setOptions({maxNumHands:1,modelComplexity:0,minDetectionConfidence:.65,minTrackingConfidence:.65});hands.onResults(onHandResults);}$('gesture-status').textContent='请将手放入画面';
 const track=async()=>{if(token!==cameraToken)return;if(!gestureBusy&&$('webcam').readyState>=2){gestureBusy=true;try{await hands.send({image:$('webcam')});}catch(error){if(token===cameraToken){stopCamera();toast('手势识别加载失败，已切回鼠标模式');}return;}finally{gestureBusy=false;}}if(token===cameraToken)gestureFrame=requestAnimationFrame(track);};track();
 }catch(error){if(token!==cameraToken)return;stopCamera();toast(error.name==='NotAllowedError'?'摄像头权限未获允许，已切回鼠标模式':error.name==='NotFoundError'?'没有检测到摄像头，已切回鼠标模式':error.message||'摄像头启动失败，已切回鼠标模式');}
}
$('mode-gesture').onclick=startCamera;$('mode-mouse').onclick=stopCamera;$('close-camera').onclick=stopCamera;
window.addEventListener('pagehide',()=>{persist();stopCamera();});
sync();resize();setView('perspective');persist();
function getDocument(){
 const spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
 const active=document.querySelector('[data-view].active');
 return {...clone(),name:state.name.trim()||'未命名的陶器',wheel:{rotating,speed_rpm:wheelSpeed,rotation_deg:poseRotation},view:{direction:active?.dataset.view||'custom',azimuth_deg:THREE.MathUtils.radToDeg(spherical.theta),polar_deg:THREE.MathUtils.radToDeg(spherical.phi),zoom_percent:THREE.MathUtils.clamp(BASE_DISTANCE/spherical.radius*100,57,190)}};
}
function applyDocument(documentState,history){
 applyingRemote=true;
 try{
  commitEdit();state=validateProject(documentState);sync();
  if(rotating!==documentState.wheel.rotating)toggleRotation();
  poseRotation=documentState.wheel.rotation_deg??0;pottery.rotation.y=wheel.rotation.y=poseRotation*Math.PI/180;
  wheelSpeed=documentState.wheel.speed_rpm;$('wheel-speed').value=wheelSpeed;$('wheel-speed-value').value=wheelSpeed;paintRange($('wheel-speed'));
  const view=documentState.view, damp=controls.enableDamping;controls.enableDamping=false;controls.update();
  controls.target.set(0,state.height/12,0);
  const offset=new THREE.Vector3().setFromSpherical(new THREE.Spherical(BASE_DISTANCE/(view.zoom_percent/100),THREE.MathUtils.degToRad(view.polar_deg),THREE.MathUtils.degToRad(view.azimuth_deg)));
  camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);controls.update();controls.enableDamping=damp;
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view.direction));updateZoom();
  if(history){remoteHistory={undo:history.undo_count,redo:history.redo_count};historyUI();}
  renderer.render(scene,camera);persist();
 }finally{applyingRemote=false;}
 return getDocument();
}
async function exportArtifact(format){
 let blob;
 if(format==='obj')blob=objBlob();
 else if(format==='json')blob=new Blob([JSON.stringify({format:'taowu-pottery',version:2,...getDocument()},null,2)],{type:'application/json'});
 else if(format==='png'){const visible=brushRing.visible;brushRing.visible=false;renderer.render(scene,camera);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));brushRing.visible=visible;}
 else throw Error('没有这种导出格式');
 if(!blob?.size)throw Error('文件生成失败');
 const filename=`${(state.name.trim()||'陶物作品').replace(/[\\/:*?"<>|]/g,'_')}.${format}`;
 return {blob,format,filename,bytes:blob.size};
}
window.PotteryWorkbench={getState:getDocument,applyState:applyDocument,exportArtifact,download,
 subscribe(listener){changeListeners.add(listener);return()=>changeListeners.delete(listener);},
 setHistory(value){remoteHistory={undo:value.undo_count,redo:value.redo_count};historyUI();},
 finishEdit:commitEdit,prepareForCommand(){commitEdit();notifyChange();},pauseForVoice(){if(rotating)toggleRotation();},refreshShapeControls:outlineUI,isEditing:()=>Boolean(editStart||interaction||handSession),onCommand:null,onTool:null};
let prevTime=performance.now(),fpsTime=prevTime,frames=0;
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-prevTime)/1000,.05);prevTime=now;if(rotating){const rotation=dt*wheelSpeed/60*Math.PI*2;pottery.rotation.y+=rotation;wheel.rotation.y+=rotation;}controls.update();renderer.render(scene,camera);frames++;if(now-fpsTime>=1000){$('fps-badge').textContent=`${Math.round(frames*1000/(now-fpsTime))} FPS`;frames=0;fpsTime=now;}}
requestAnimationFrame(animate);
})();

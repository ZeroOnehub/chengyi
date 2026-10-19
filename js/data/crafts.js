// 品类配置。新增可创作品类时补这里的配置与素材，不改工坊页面。
import { validPottery } from '../core/pottery.js';

export const CRAFT_NAMES = {
  ceramic: '瓷器',
  paper: '剪纸',
  textile: '染织',
  wood: '木作',
  metal: '金工',
  pending: '地区工艺',
};

export const PATTERNS = [
  { id: 'plain', name: '素面', meaning: '不加纹饰，突出器形与釉色本身。', album: null },
  { id: 'flower', name: '花卉', meaning: '缠枝花卉连绵不断，寓意生生不息。', album: 'pattern-flower' },
  { id: 'cloud', name: '云纹', meaning: '祥云回旋，寓意吉祥如意。', album: 'pattern-cloud' },
  { id: 'geometry', name: '几何', meaning: '回纹、菱格反复相连，俗称「富贵不断头」。', album: 'pattern-geometry' },
];

export const CRAFTS = {
  ceramic: {
    title: '瓷器工坊',
    shapeLabel: '器型',
    colorLabel: '釉色',
    colors: [
      { id: 'jade', name: '青绿', hex: '#9ab9a5' },
      { id: 'blue', name: '靛蓝', hex: '#385e88' },
      { id: 'white', name: '月白', hex: '#e2dfcb' },
      { id: 'clay', name: '暖陶', hex: '#c5a17c' },
      { id: 'brown', name: '紫砂', hex: '#735545' },
      { id: 'charcoal', name: '墨黑', hex: '#444843' },
    ],
    shapes: [
      { id: 'vase', name: '花瓶' },
      { id: 'bowl', name: '碗' },
      { id: 'jar', name: '罐' },
      { id: 'cup', name: '杯' },
    ],
    steps: [
      { name: '选型塑坯', album: 'craft-shape' },
      { name: '施釉绘饰', album: 'craft-glaze' },
      { name: '窑火成器', album: 'craft-fire' },
    ],
    copy: [
      '选择一种器型。想要高一点、宽一点，也可以告诉 AI。',
      '挑选釉色与纹样。生釉颜色发灰、表面粉涩，要入窑烧过才显出真正的釉色。',
      '入窑烧成：窑温升到一千三百度上下，釉熔成玻璃质。这里是示意，真实烧制还有温度、气氛与窑位的变化。',
    ],
    prompts: ['做一只青绿色花瓶', '花纹改成花卉，瓶口窄一点', '为什么青花是蓝色的'],
    placeholder: '例如：做一只青绿色的花瓶',
    greeting: '我们先选器型。你可以说「做一只青绿色花瓶」，我会先给出修改建议，你确认后器物才会变化。想知道某道工序的来历，也可以直接问我。',
    defaultState: { shape: 'vase', color: 'jade', pattern: 'plain', width: 1, complexity: 1, step: 0 },
    orderSize: '高约 15 厘米',
    orderMaterials: ['瓷质（需匠人确认）', '由匠人建议'],
  },
  paper: {
    title: '剪纸工坊',
    shapeLabel: '纸形',
    colorLabel: '纸色',
    colors: [
      { id: 'red', name: '朱红', hex: '#bf563f' },
      { id: 'blue', name: '靛蓝', hex: '#41678a' },
      { id: 'ivory', name: '米白', hex: '#d7cfb4' },
      { id: 'gold', name: '暖金', hex: '#c6a05c' },
    ],
    shapes: [
      { id: 'round', name: '圆形' },
      { id: 'square', name: '方形' },
      { id: 'diamond', name: '菱形' },
    ],
    steps: [
      { name: '折纸定样', album: 'craft-fold' },
      { name: '剪刻纹样', album: 'craft-cut' },
      { name: '展开成作', album: 'craft-unfold' },
    ],
    copy: [
      '选纸形和纸色。纸已经对折成一角，剪一刀，展开就是对称的几处。',
      '挑选纹样、调繁简。剪口落在折叠的这一角上，锯齿、月牙都在这里剪出。',
      '展开成作。折痕还留在纸上；真实剪纸的连通结构还需匠人审核。',
    ],
    prompts: ['做一张红色圆形剪纸', '换成花卉纹样，简单一点', '剪纸为什么要对折'],
    placeholder: '例如：做一张红色圆形剪纸',
    greeting: '我们从一张纸开始。你可以说「做一张红色圆形剪纸」，我会先列出建议，等你确认后再应用。想了解剪纸的门道，也可以直接问我。',
    defaultState: { shape: 'round', color: 'red', pattern: 'flower', width: 1, complexity: 1, step: 0 },
    orderSize: '20 × 20 厘米',
    orderMaterials: ['纸质（需匠人确认）', '由匠人建议'],
  },
};

export const STEP_COUNT = 3;

export const defaultState = craft => ({ ...CRAFTS[craft].defaultState });

export const clampState = s => ({
  ...s,
  width: Math.max(0.75, Math.min(1.2, s.width)),
  complexity: Math.max(0.6, Math.min(1.3, s.complexity)),
});

export function validState(craft, s) {
  const c = CRAFTS[craft];
  return !!c && !!s
    && c.shapes.some(x => x.id === s.shape)
    && c.colors.some(x => x.id === s.color)
    && PATTERNS.some(x => x.id === s.pattern)
    && Number.isInteger(s.step) && s.step >= 0 && s.step < STEP_COUNT
    && Number.isFinite(s.width) && s.width >= 0.75 && s.width <= 1.2
    && Number.isFinite(s.complexity) && s.complexity >= 0.6 && s.complexity <= 1.3
    && (craft !== 'ceramic' || !s.pottery || validPottery(s.pottery));
}

export const colorOf = (craft, id) => CRAFTS[craft]?.colors.find(c => c.id === id);
export const shapeOf = (craft, id) => CRAFTS[craft]?.shapes.find(c => c.id === id);
export const patternOf = id => PATTERNS.find(p => p.id === id);

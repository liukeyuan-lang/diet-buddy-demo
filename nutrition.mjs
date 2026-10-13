// Small, traceable nutrition reference used for conservative range estimates.
// Values are per 100 g from USDA FoodData Central SR Legacy (April 2018).
// The subset is intentionally narrow: an unmapped food stays unmapped instead
// of being assigned a plausible-looking value.
export const NUTRITION_DATA_VERSION = 'usda-fdc-sr-legacy-2018-04-subset-v2';
export const NUTRITION_ESTIMATOR_VERSION = 'dietbuddy-meal-range-v2';
export const NUTRITION_SOURCE = Object.freeze({
  name: 'USDA FoodData Central',
  dataType: 'SR Legacy',
  release: '2018-04',
  url: 'https://fdc.nal.usda.gov/download-datasets/',
  version: NUTRITION_DATA_VERSION,
});

export const NUTRITION_FOODS = Object.freeze({
  rice_cooked: food('熟白米饭', 168930, 'Rice, white, medium-grain, cooked, unenriched', 130, 2.38, 28.6, 0.21),
  noodles_cooked: food('熟鸡蛋面', 169762, 'Noodles, egg, cooked, unenriched, with added salt', 138, 4.54, 25.2, 2.07),
  egg_cooked: food('熟全蛋', 173424, 'Egg, whole, cooked, hard-boiled', 155, 12.6, 1.12, 10.6),
  chicken_breast: food('熟鸡胸肉', 171477, 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 165, 31, 0, 3.57),
  pork_lean: food('熟猪里脊（含可分离脂肪）', 167842, 'Pork, fresh, loin, top loin (roasts), boneless, separable lean and fat, cooked, roasted', 192, 26.4, 0, 8.82),
  beef_lean: food('熟牛绞肉（90% 瘦）', 171795, 'Beef, ground, 90% lean meat / 10% fat, loaf, cooked, baked', 214, 26.6, 0, 11.1),
  tofu_firm: food('北豆腐 / 老豆腐', 172475, 'Tofu, raw, firm, prepared with calcium sulfate', 144, 17.3, 2.78, 8.72),
  tomato: food('番茄', 170457, 'Tomatoes, red, ripe, raw, year round average', 18, 0.88, 3.89, 0.2),
  broccoli_cooked: food('熟西兰花', 168510, 'Broccoli, cooked, boiled, drained, with salt', 35, 2.38, 7.18, 0.41),
  spinach_cooked: food('熟菠菜', 168463, 'Spinach, cooked, boiled, drained, without salt', 23, 2.97, 3.75, 0.26),
  potato_cooked: food('熟土豆', 170440, 'Potatoes, boiled, cooked without skin, flesh, without salt', 86, 1.71, 20, 0.1),
  canola_oil: food('烹调油（菜籽油参照）', 172336, 'Oil, canola', 884, 0, 0, 100),
  soy_sauce: food('酱油', 174277, 'Soy sauce made from soy and wheat (shoyu)', 53, 8.14, 4.93, 0.57),
  sugar: food('白砂糖', 169655, 'Sugars, granulated', 387, 0, 100, 0),
  whole_milk: food('全脂牛奶', 171265, 'Milk, whole, 3.25% milkfat, with added vitamin D', 61, 3.15, 4.8, 3.25),
  green_pepper_raw: food('青椒（生重参照）', 170427, 'Peppers, sweet, green, raw', 20, 0.86, 4.64, 0.17),
  eggplant_raw: food('茄子（生重参照）', 169228, 'Eggplant, raw', 25, 0.98, 5.88, 0.18),
  bitter_melon_raw: food('苦瓜（生重参照）', 168393, 'Balsam-pear (bitter gourd), pods, raw', 17, 1, 3.7, 0.17),
  pollock_cooked: food('熟大西洋明太鱼（鱼馅下界参照）', 174237, 'Fish, pollock, Atlantic, cooked, dry heat', 118, 24.9, 0, 1.26),
});

function food(label, fdcId, description, kcal, protein, carbs, fat) {
  return Object.freeze({ label, fdcId, description, per100g: Object.freeze({ kcal, protein, carbs, fat }) });
}

export function nutritionFoodOptions() {
  return Object.entries(NUTRITION_FOODS).map(([key, item]) => ({ key, label: item.label, fdcId: item.fdcId }));
}

function finiteAmount(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(3000, number)) : fallback;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function normalizeEstimateLine(raw = {}) {
  const gramsA = finiteAmount(raw.gramsMin);
  const gramsB = finiteAmount(raw.gramsMax);
  const hasRange = gramsA !== null && gramsB !== null;
  return {
    name: String(raw.name || '').trim().slice(0, 80),
    foodKey: Object.hasOwn(NUTRITION_FOODS, raw.foodKey) ? raw.foodKey : 'unknown',
    gramsMin: hasRange ? Math.min(gramsA, gramsB) : null,
    gramsMax: hasRange ? Math.max(gramsA, gramsB) : null,
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    origin: ['ai-suggested', 'user-edited'].includes(raw.origin) ? raw.origin : 'unknown',
  };
}

function emptyTotals() {
  return { kcal: [0, 0], protein: [0, 0], carbs: [0, 0], fat: [0, 0] };
}

function addReference(totals, reference, gramsMin, gramsMax, scale = 1) {
  for (const nutrient of Object.keys(totals)) {
    totals[nutrient][0] += reference.per100g[nutrient] * gramsMin * scale / 100;
    totals[nutrient][1] += reference.per100g[nutrient] * gramsMax * scale / 100;
  }
}

function rangeFromTotals(totals, includeMacros = true) {
  const result = { kcal: { min: round(totals.kcal[0], 0), max: round(totals.kcal[1], 0), unit: 'kcal' } };
  if (!includeMacros) return result;
  for (const nutrient of ['protein', 'carbs', 'fat']) {
    result[nutrient] = { min: round(totals[nutrient][0], 1), max: round(totals[nutrient][1], 1), unit: 'g' };
  }
  return result;
}

function matchingLine(lines, pattern) {
  return lines.find((line) => pattern.test(line.name));
}

// This deliberately narrow rule is an evidence-backed fallback for a named,
// visually distinctive composite dish. It is not a general recipe database.
// Components are mutually exclusive: the observed whole dish is never added
// on top of its vegetables/filling, and an explicit oil line replaces (rather
// than supplements) the cooking-method oil allowance.
function estimateStuffedThreeTreasures(input, ingredientLines, sauceLines, portionScale) {
  const dishName = String(input.dishName || input.food || '').trim();
  const recognized = input.recognized ?? input.aiAnalysis?.recognized;
  const evidenceText = ingredientLines.map((line) => line.name).join(' ');
  const namedDish = /酿三宝/.test(dishName) || (/酿/.test(dishName) && [/青椒/, /茄子/, /苦瓜/].filter((part) => part.test(`${dishName} ${evidenceText}`)).length >= 2);
  const vegetables = [
    { pattern: /青椒/, key: 'green_pepper_raw', label: '青椒' },
    { pattern: /茄子/, key: 'eggplant_raw', label: '茄子' },
    { pattern: /苦瓜/, key: 'bitter_melon_raw', label: '苦瓜' },
  ].map((item) => ({ ...item, observed: matchingLine(ingredientLines, item.pattern) })).filter((item) => item.observed);
  // The editable component list is authoritative. Removing a component must
  // remove it from the next estimate; the dish name alone never adds it back.
  if (recognized === false || !namedDish || vegetables.length < 2) return null;

  const totals = emptyTotals();
  const assumptions = [];
  const coveredNames = [];
  for (const item of vegetables) {
    const wholeStuffedPiece = /酿/.test(item.observed.name);
    // A model's grams for "stuffed pepper" describe shell + filling. Reusing
    // them as vegetable grams and then adding filling would double count.
    const gramsMin = !wholeStuffedPiece && item.observed.gramsMin !== null ? item.observed.gramsMin : 15;
    const gramsMax = !wholeStuffedPiece && item.observed.gramsMax !== null ? item.observed.gramsMax : 45;
    addReference(totals, NUTRITION_FOODS[item.key], gramsMin, gramsMax, portionScale);
    coveredNames.push(item.label);
  }
  assumptions.push(`只计入当前列表中的 ${vegetables.map((item) => item.label).join('、')}。名为「酿××」的整件观察重量含馅，不当作纯蔬菜重量；蔬菜外层暂按每件 15–45g 生重参照。`);

  const filling = matchingLine(ingredientLines, /鱼滑|鱼肉馅|猪肉馅|鸡肉馅|肉馅|馅料/);
  const fillingMin = filling?.gramsMin ?? vegetables.length * 20;
  const fillingMax = filling?.gramsMax ?? vegetables.length * 50;
  const exactFilling = filling && Object.hasOwn(NUTRITION_FOODS, filling.foodKey) && filling.foodKey !== 'unknown';
  if (exactFilling) {
    addReference(totals, NUTRITION_FOODS[filling.foodKey], fillingMin, fillingMax, portionScale);
    assumptions.push(`馅料按${filling.origin === 'ai-suggested' ? 'AI 建议的' : '当前已编辑的'}「${NUTRITION_FOODS[filling.foodKey].label}」与克数计入。${filling.origin === 'ai-suggested' ? '这是可编辑假设，不是用户称重。' : ''}`);
  } else {
    const lower = NUTRITION_FOODS.pollock_cooked;
    const upper = NUTRITION_FOODS.pork_lean;
    for (const nutrient of Object.keys(totals)) {
      const lowRate = Math.min(lower.per100g[nutrient], upper.per100g[nutrient]);
      const highRate = Math.max(lower.per100g[nutrient], upper.per100g[nutrient]);
      totals[nutrient][0] += lowRate * fillingMin * portionScale / 100;
      totals[nutrient][1] += highRate * fillingMax * portionScale / 100;
    }
    assumptions.push(`馅料品类未确认，用熟明太鱼至熟猪里脊参照包络；未填克数时暂按 ${fillingMin}–${fillingMax}g。`);
  }
  coveredNames.push(filling?.name || '未确认馅料');

  const explicitOil = sauceLines.find((line) => (line.foodKey === 'canola_oil' || (!/酱油/.test(line.name) && /(?:烹调|食用|煎制|菜籽|花生|橄榄|植物|用)油/.test(line.name))) && line.gramsMin !== null && line.gramsMax !== null);
  const requestedMethod = ['pan_fried', 'steamed', 'deep_fried'].includes(input.cookingMethod) ? input.cookingMethod : 'unknown';
  const inferredMethod = requestedMethod === 'unknown' && /煎/.test(dishName) ? 'pan_fried' : requestedMethod;
  const cookingChoiceReplacesAiOil = explicitOil?.origin === 'ai-suggested' && requestedMethod !== 'unknown';
  if (explicitOil && !cookingChoiceReplacesAiOil) {
    addReference(totals, NUTRITION_FOODS.canola_oil, explicitOil.gramsMin, explicitOil.gramsMax, portionScale);
    assumptions.push(`${explicitOil.origin === 'ai-suggested' ? 'AI 建议的' : '当前已编辑的'}用油条目 ${explicitOil.gramsMin}–${explicitOil.gramsMax}g 已计入，不再叠加烹调方式默认用油。${explicitOil.origin === 'ai-suggested' ? '这不是用户称重；可修改克数或选择烹调方式替换该假设。' : ''}`);
    coveredNames.push(explicitOil.name || '烹调油');
  } else {
    const oilRange = inferredMethod === 'steamed' ? [0, 5] : inferredMethod === 'deep_fried' ? [15, 35] : inferredMethod === 'pan_fried' ? [8, 20] : [0, 20];
    addReference(totals, NUTRITION_FOODS.canola_oil, oilRange[0], oilRange[1], portionScale);
    const methodLabel = ({ steamed: '清蒸', deep_fried: '油炸', pan_fried: '煎/香煎', unknown: '烹调方式未确认' })[inferredMethod];
    assumptions.push(`${cookingChoiceReplacesAiOil ? '已用你选择的烹调方式替换 AI 未确认的用油克数；' : '没有可用的用油克数，'}${methodLabel}场景暂按 ${oilRange[0]}–${oilRange[1]}g 菜籽油参照；这是假设，不是照片称重。`);
  }

  for (const sauce of sauceLines) {
    if (sauce === explicitOil || sauce.foodKey === 'canola_oil') continue;
    const reference = Object.hasOwn(NUTRITION_FOODS, sauce.foodKey) ? NUTRITION_FOODS[sauce.foodKey] : null;
    if (!reference || sauce.gramsMin === null || sauce.gramsMax === null) continue;
    addReference(totals, reference, sauce.gramsMin, sauce.gramsMax, portionScale);
    coveredNames.push(sauce.name);
  }
  assumptions.push('区间为整餐粗估，仅使用 USDA 参照食材与上述情景规则；鱼滑中可能的淀粉、其他配料及实际吸油未必完整覆盖。');

  return {
    range: rangeFromTotals(totals, false),
    macroRange: null,
    estimateKind: 'rough-whole-meal',
    ruleId: 'stuffed-three-treasures-envelope',
    ruleVersion: '1',
    method: 'USDA 原子食材 + 鱼/猪馅料情景包络 + 互斥用油假设',
    coveredNames,
    assumptions,
    suggestions: ['可选补充馅料类型、馅料克数或实际用油，用于更新估算、减少不确定信息；不补充也可保存这个粗估。'],
  };
}

export function estimateMealNutrition(input = {}) {
  const portionScale = Math.max(0.1, Math.min(3, finiteAmount(input.portionScale, 100) / 100));
  const ingredientLines = (input.ingredients || []).map(normalizeEstimateLine);
  const sauceLines = (input.fatsAndSauces || []).map(normalizeEstimateLine);
  const lines = [...ingredientLines, ...sauceLines];
  const totals = emptyTotals();
  const mapped = [];
  const unmappedIngredients = [];
  const missingPortions = [];

  for (const line of lines) {
    const reference = Object.hasOwn(NUTRITION_FOODS, line.foodKey) ? NUTRITION_FOODS[line.foodKey] : null;
    if (!reference) {
      if (line.name) unmappedIngredients.push(line.name);
      continue;
    }
    if (line.gramsMin === null || line.gramsMax === null) {
      if (line.name) missingPortions.push(line.name);
      continue;
    }
    mapped.push({ ...line, fdcId: reference.fdcId });
    addReference(totals, reference, line.gramsMin, line.gramsMax, portionScale);
  }

  const mainMappedCount = ingredientLines.filter((line) => Object.hasOwn(NUTRITION_FOODS, line.foodKey) && line.gramsMin !== null && line.gramsMax !== null).length;
  const completeIngredientSum = lines.length > 0 && ingredientLines.length > 0 && mainMappedCount > 0
    && !unmappedIngredients.length && !missingPortions.length;
  const scenario = estimateStuffedThreeTreasures(input, ingredientLines, sauceLines, portionScale);
  const range = scenario?.range || (completeIngredientSum ? rangeFromTotals(totals) : null);
  const partialRange = !scenario && mapped.length && !completeIngredientSum ? rangeFromTotals(totals) : null;

  const includesAiSuggestedAmounts = mapped.some((line) => line.origin === 'ai-suggested');
  const assumptions = scenario?.assumptions || [
    `按当前食材克数区间并乘以 ${round(portionScale * 100, 0)}% 份量系数计算。${includesAiSuggestedAmounts ? '其中包含 AI 建议且未经用户编辑的克数，不是称重。' : '这些克数来自当前编辑值。'}`,
    '不同品牌、部位、烹调失水和实际用油会改变结果；区间不是精确测量。',
  ];
  if (!scenario && unmappedIngredients.length) assumptions.push('未映射食材未计入小计，不能将已映射条目冒充整餐。');
  if (!scenario && missingPortions.length) assumptions.push('缺少克数的食材未计入小计；可选补充后重算。');
  if (!lines.length) assumptions.push('尚未填写可计算的食材。');

  return {
    range,
    partialRange,
    macroRange: scenario ? null : range,
    estimateKind: scenario?.estimateKind || (completeIngredientSum ? 'ingredient-sum' : partialRange ? 'partial-subtotal' : 'unavailable'),
    estimatorVersion: NUTRITION_ESTIMATOR_VERSION,
    ruleId: scenario?.ruleId || null,
    ruleVersion: scenario?.ruleVersion || null,
    method: scenario?.method || '按 USDA 单项参照值与当前估计 / 填写克数相加',
    suggestions: scenario?.suggestions || (unmappedIngredients.length || missingPortions.length ? ['可选补充食材对应项与克数后重算；不补充也可先保存餐食记录。'] : []),
    mappedCount: mapped.length,
    totalCount: lines.length,
    mapped,
    unmappedIngredients,
    missingPortions,
    assumptions,
    source: NUTRITION_SOURCE,
    calculatedAt: new Date().toISOString(),
  };
}

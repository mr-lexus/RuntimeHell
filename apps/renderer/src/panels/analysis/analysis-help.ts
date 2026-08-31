import type { AnalysisType } from '@rh/protocol';

/** Font Awesome glyphs provided by the bundled JetBrainsMono Nerd Font. */
export const ANALYSIS_ACTION_ICON = {
  info: '\uf129',
  demo: '\uf135',
  play: '\uf04b',
  cancel: '\uf00d',
  copy: '\uf0c5',
  overview: '\uf0e2',
  focus: '\uf05b',
  hierarchy: '\uf0e8',
  fit: '\uf047'
} as const;

export const ANALYSIS_ICON: Record<AnalysisType, string> = {
  ast: '\uf03a',
  bytecode: '\uf1c9',
  optcode: '\uf085',
  'ir-graph': '\uf0e8',
  deopts: '\uf071',
  gc: '\uf2db'
};

export const ANALYSIS_HELP: Record<AnalysisType, { title: string; summary: string; details: string }> = {
  ast: {
    title: 'AST · abstract syntax tree',
    summary: 'Структура исходного JavaScript после разбора парсером.',
    details: 'Показывает программы, функции, объявления, выражения, вызовы и литералы. Normalized — компактное семантическое дерево, Raw — оригинальный вывод движка.'
  },
  bytecode: {
    title: 'Bytecode · байткод',
    summary: 'Инструкции виртуальной машины до JIT-компиляции.',
    details: 'Показывает opcode, смещение инструкции, операнды и constant pool. Это промежуточный исполняемый формат движка, а не машинный код процессора.'
  },
  optcode: {
    title: 'Optimized code · оптимизированный код',
    summary: 'Машинный код, созданный JIT-компилятором для горячих функций.',
    details: 'Помогает увидеть результат оптимизации: инструкции, адреса и операнды. Для появления результата код должен реально выполниться и прогреться.'
  },
  'ir-graph': {
    title: 'IR graph · промежуточное представление',
    summary: 'Граф операций компилятора на последовательных стадиях оптимизации.',
    details: 'Узлы — операции, стрелки — зависимости между ними. Можно выбрать фазу, приблизить граф, посмотреть соседей узла и включить hierarchy/focus режим.'
  },
  deopts: {
    title: 'Deopts · деоптимизации',
    summary: 'Моменты, когда движок отказался от оптимизированного кода.',
    details: 'Показывает функцию, тип события, причину и bytecode offset. Деоптимизация обычно означает, что предположение JIT перестало быть верным.'
  },
  gc: {
    title: 'GC · garbage collection',
    summary: 'События сборщика мусора и связанные с ними паузы.',
    details: 'Показывает тип коллектора, изменение heap, длительность паузы и причину запуска. Нормализованная сводка удобна для сравнения нагрузки на память.'
  }
};

export const ANALYSIS_VIEW_ICONS: Record<'normalized' | 'raw' | 'artifacts', string> = {
  normalized: '\uf03a',
  raw: '\uf1c9',
  artifacts: '\uf1b3'
};

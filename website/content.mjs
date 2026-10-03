export const content = {
  en: {
    title: 'RuntimeHell — See what your JavaScript is really doing',
    description: 'A compact desktop workbench for JavaScript and TypeScript. Run Node.js, Deno, Bun and Chromium, inspect live results, and compare performance.',
    nav: ['The workbench', 'Inside the app', 'Download'], lang: 'Language', skip: 'Skip to content',
    badge: 'PUBLIC BETA · BUILT FOR THE CURIOUS', hero: ['Your code.', 'Nothing hidden.'],
    intro: 'Run it. Inspect it. Understand it. A focused JavaScript & TypeScript workbench that puts the answers right beside your code.',
    cta: 'Get the beta', source: 'Explore the source', platforms: 'Windows · macOS · Linux',
    caption: 'Real code. Real results. No console.log required.', screenAlt: 'RuntimeHell running TypeScript with an expanded object and its prototype beside the source',
    runtimeLabel: 'ONE WORKSPACE. FOUR WAYS TO RUN.',
    manifesto: ['Less interface.', 'More insight.'], manifestoText: 'The editor gets the room. The tools are there when you need them. Move from a quick idea to a deeper experiment without losing your train of thought.',
    featureIntro: '01 / SEE THROUGH YOUR CODE', featureTitle: 'The value is in the details.', featureText: 'Objects, arrays, hidden properties and prototype chains — right next to their source lines. Expand a value to explore it. Keep writing without a wall of console logs.',
    featureBullets: ['Top-level values, no logging ceremony', 'Destructuring and multiple values per line', 'Accessor markers instead of surprise getter calls'],
    perfIntro: '02 / MEASURE, DON’T GUESS', perfTitle: 'Turn “I think” into a comparison.', perfText: 'Capture code samples. Choose runtimes and optimizer profiles. Compare median time, throughput and distributions in one Performance Lab.',
    perfCaption: 'An actual local benchmark. Results depend on your code, runtime and machine.', perfAlt: 'Performance Lab comparing two real JavaScript benchmark samples with results and a bar chart',
    layoutIntro: '03 / MAKE ROOM TO THINK', layoutTitle: 'A workspace that fits you.', layoutText: 'A quiet editor or a side-by-side investigation. Choose a layout, move the tools, adjust density, or switch to focus mode. Your code stays at the center.', layoutAlt: 'RuntimeHell layout controls with Code, Run and Analyze presets',
    moreTitle: 'Small surface. Serious tools.',
    tools: [
      ['{ }', 'Engine internals', 'Explore AST, bytecode, IR and optimization traces when your engine build supports them.'],
      ['↳', 'Packages → code', 'Install a dependency, insert an import, and bring in a commented README example. One Undo takes it back.'],
      ['⌘', 'Keyboard first', 'Monaco editing, a command palette and an optional LazyVim-style keymap profile.'],
      ['◐', 'Your kind of focus', 'Themes, accents, density, reduced motion and a layout that remembers how you work.']
    ],
    downloadEyebrow: 'READY FOR YOUR NEXT EXPERIMENT?', downloadTitle: 'Go from “what if” to “now I see”.', downloadText: 'Free, open-source, and ready to explore. Choose your platform and help shape the beta.',
    downloadNames: ['Windows', 'macOS · Apple Silicon', 'macOS · Intel', 'Linux'], downloadDetails: ['x64 · Installer', 'arm64 · DMG', 'x64 · DMG', 'x64 · AppImage'],
    allDownloads: 'All downloads & release notes', checksums: 'SHA-256 checksums',
    cautionTitle: 'A beta, with clear boundaries.', caution: 'Installers are unsigned; macOS builds are not notarized. Your OS may show a security warning. RuntimeHell runs code with your account’s permissions — it is not a security sandbox. Run only code you trust. Engine capabilities vary by platform and build.',
    faqTitle: 'A few things worth knowing.',
    faq: [
      ['Is this a replacement for my IDE?', 'Think of it as a dedicated place to explore a snippet, inspect a value, compare runtimes or investigate engine behavior. It complements your main editor.'],
      ['Does Values inspect every local variable?', 'Values captures top-level expressions and declarations when code runs. Results are snapshots, not a full debugger trace. Very large trees are bounded, and getters are not evaluated automatically.'],
      ['Are all runtimes and engines bundled?', 'Embedded Chromium is included. Other runtimes can use detected local installations or supported managed downloads. Analysis needs a compatible engine build; not every catalog entry supports every feature.'],
      ['What does beta mean here?', 'The main workflows are ready for testing, but bugs and platform-specific limitations remain possible. Keep backups of important workspaces and report reproducible issues on GitHub.']
    ],
    footer: 'For developers who want to know why.', issues: 'Report an issue', privacy: 'No analytics. No account required.', close: 'Close screenshot', enlarge: 'View full screenshot', github: 'GitHub repository'
  },
  ru: {
    title: 'RuntimeHell — Посмотри, что на самом деле делает твой JavaScript',
    description: 'Компактная среда для JavaScript и TypeScript: Node.js, Deno, Bun и Chromium, значения рядом с кодом и сравнение производительности.',
    nav: ['Рабочая среда', 'Возможности', 'Скачать'], lang: 'Язык', skip: 'К содержимому',
    badge: 'ПУБЛИЧНАЯ БЕТА · ДЛЯ ТЕХ, КОМУ ИНТЕРЕСНО', hero: ['Твой код.', 'Всё на виду.'],
    intro: 'Запускай. Исследуй. Понимай. Среда для JavaScript и TypeScript, в которой ответы находятся прямо рядом с кодом.',
    cta: 'Скачать бету', source: 'Посмотреть исходники', platforms: 'Windows · macOS · Linux',
    caption: 'Настоящий код. Настоящие результаты. Без console.log.', screenAlt: 'TypeScript в RuntimeHell: раскрытый объект и его прототип рядом с исходным кодом',
    runtimeLabel: 'ОДНА СРЕДА. ЧЕТЫРЕ СПОСОБА ЗАПУСКА.',
    manifesto: ['Меньше интерфейса.', 'Больше понимания.'], manifestoText: 'Редактору — максимум места. Инструменты — под рукой, когда нужны. От быстрой идеи до глубокого эксперимента, не теряя ход мысли.',
    featureIntro: '01 / СМОТРИ СКВОЗЬ КОД', featureTitle: 'Всё дело в деталях.', featureText: 'Объекты, массивы, скрытые свойства и цепочки прототипов — рядом со строками кода. Раскрой значение и изучай дальше. Без стены из console.log.',
    featureBullets: ['Значения верхнего уровня без лишнего логирования', 'Деструктуризация и несколько значений на строке', 'Геттеры помечаются, а не вызываются неожиданно'],
    perfIntro: '02 / ИЗМЕРЯЙ, А НЕ ГАДАЙ', perfTitle: 'Вместо «кажется» — сравнение.', perfText: 'Выдели фрагменты. Выбери среды и профили оптимизации. Сравни медиану, пропускную способность и распределение замеров в Performance Lab.',
    perfCaption: 'Реальный локальный замер. Результаты зависят от кода, среды и компьютера.', perfAlt: 'Performance Lab: сравнение двух фрагментов JavaScript с реальными результатами и диаграммой',
    layoutIntro: '03 / ОСВОБОДИ МЕСТО ДЛЯ МЫСЛЕЙ', layoutTitle: 'Твоё рабочее пространство.', layoutText: 'Чистый редактор или исследование бок о бок. Выбирай компоновку, перемещай инструменты, меняй плотность или включай фокус. Код остаётся в центре.', layoutAlt: 'Настройка интерфейса RuntimeHell: пресеты Code, Run и Analyze',
    moreTitle: 'Компактный снаружи. Серьёзный внутри.',
    tools: [
      ['{ }', 'Внутри движка', 'Исследуй AST, байткод, IR и трассировки оптимизации — в пределах возможностей выбранной сборки движка.'],
      ['↳', 'Из Packages — в код', 'Установи зависимость, вставь импорт и пример из README в комментарии. Один Undo отменяет всю вставку.'],
      ['⌘', 'С клавиатуры быстрее', 'Редактор Monaco, палитра команд и опциональный профиль сочетаний в стиле LazyVim.'],
      ['◐', 'Фокус по твоим правилам', 'Темы, акценты, плотность, уменьшенная анимация и компоновка, которая помнит твои привычки.']
    ],
    downloadEyebrow: 'ГОТОВ К СЛЕДУЮЩЕМУ ЭКСПЕРИМЕНТУ?', downloadTitle: 'От «а что, если» до «теперь понятно».', downloadText: 'Бесплатно, с открытым кодом и готово к экспериментам. Выбирай платформу и помогай улучшать бету.',
    downloadNames: ['Windows', 'macOS · Apple Silicon', 'macOS · Intel', 'Linux'], downloadDetails: ['x64 · Установщик', 'arm64 · DMG', 'x64 · DMG', 'x64 · AppImage'],
    allDownloads: 'Все загрузки и заметки о релизе', checksums: 'Контрольные суммы SHA-256',
    cautionTitle: 'Бета с понятными границами.', caution: 'Установщики без цифровой подписи, сборки macOS без notarization. ОС может показать предупреждение безопасности. Код выполняется с правами твоей учётной записи — это не защищённая песочница. Запускай только доверенный код. Возможности движков зависят от платформы и сборки.',
    faqTitle: 'Ещё несколько важных деталей.',
    faq: [
      ['Это замена моей IDE?', 'Скорее отдельное место, чтобы исследовать фрагмент, посмотреть значение, сравнить среды или разобраться в поведении движка. RuntimeHell дополняет основной редактор.'],
      ['Values показывает все локальные переменные?', 'Values фиксирует выражения и объявления верхнего уровня при выполнении кода. Это снимки значений, а не полная трассировка отладчика. Размер больших деревьев ограничен, геттеры автоматически не вызываются.'],
      ['Все среды и движки уже внутри?', 'Встроенный Chromium включён. Другие среды используют локальные установки или поддерживаемые загрузки. Для анализа нужна совместимая сборка движка; не каждый пункт каталога поддерживает все функции.'],
      ['Что здесь означает бета?', 'Основные сценарии готовы к тестированию, но возможны ошибки и ограничения отдельных платформ. Сохраняй резервные копии важных файлов и отправляй воспроизводимые баги на GitHub.']
    ],
    footer: 'Для разработчиков, которым важно понять почему.', issues: 'Сообщить об ошибке', privacy: 'Без аналитики. Без регистрации.', close: 'Закрыть скриншот', enlarge: 'Открыть скриншот целиком', github: 'Репозиторий GitHub'
  }
};

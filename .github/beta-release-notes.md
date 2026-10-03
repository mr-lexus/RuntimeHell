# RuntimeHell 0.1.0-beta.1

## English

The first public beta brings a quieter workspace and a clearer view of what your JavaScript and TypeScript actually do.

- Compact, customizable workspace: layout presets, dock positioning, focus mode, searchable settings, themes, density and motion preferences.
- Values beside your code without `console.log`: expandable properties and prototype chains, destructuring, multiple values per line, hidden/symbol properties and non-evaluated getters.
- Redesigned Performance Lab: clear setup/results flow, animated progress, persistent completion/cancellation states and reliable mouse-wheel scrolling.
- Packages → Import: insert a documented import from the installed package's README, optionally add a commented example, avoid collisions and undo the whole edit in one step. Inserting an import does not auto-run it.
- Monaco editor and the existing LazyVim-style keymap profile; Node.js, Deno, Bun and embedded Chromium execution; capability-dependent engine analysis.

### Downloads

Windows x64: `.exe` · macOS Intel: `mac-x64.dmg` / `.zip` · macOS Apple Silicon: `mac-arm64.dmg` / `.zip` · Linux x64: `.AppImage` / `.deb`.

`SHA256SUMS.txt` contains artifact checksums. Builds are currently **unsigned**; macOS builds are **not notarized**, so your operating system may show a security warning. Download only from this repository. RuntimeHell executes code with your account's privileges: it is **not a security sandbox**. Engine support depends on platform and installed binaries. Beta releases may still contain bugs; keep backups of important workspaces.

## Русский

Первая публичная бета: компактное рабочее пространство и более прозрачный JavaScript/TypeScript.

- Гибкий интерфейс: пресеты компоновки, перемещение панелей, режим фокуса, поиск настроек, темы, плотность и управление анимациями.
- Значения рядом с кодом без `console.log`: свойства, цепочки прототипов, деструктуризация, несколько значений на строке, скрытые и символьные свойства. Геттеры отображаются без вызова.
- Переработанный Performance Lab: понятный запуск и результаты, плавный прогресс, сохранение статуса завершения/отмены, исправленная прокрутка колёсиком.
- Кнопка Import в Packages: импорт по README установленного пакета, необязательный закомментированный пример, защита от конфликтов имён и отмена одним Undo. Вставка не запускает код автоматически.
- Monaco и профиль сочетаний LazyVim; запуск Node.js, Deno, Bun и встроенного Chromium; анализ движков в пределах возможностей выбранной сборки.

Установщики: Windows x64 — `.exe`; macOS Intel — `mac-x64.dmg`/`.zip`; Apple Silicon — `mac-arm64.dmg`/`.zip`; Linux x64 — `.AppImage`/`.deb`. Контрольные суммы — `SHA256SUMS.txt`.

Сборки пока **без цифровой подписи**, macOS — **без notarization**. ОС может показать предупреждение безопасности. Скачивайте только из этого репозитория. Программа выполняет код с правами вашей учётной записи и **не является безопасной песочницей**. Возможности движков зависят от платформы и установленных сборок. Это бета: сохраняйте резервные копии важных рабочих файлов.

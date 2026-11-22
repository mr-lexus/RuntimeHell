/** Electron handles beforeunload through will-prevent-unload. Let it finish
 * saving instead of letting Playwright also accept the same native dialog. */
export async function firstTestWindow(app) {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => {
    if (dialog.type() !== 'beforeunload') void dialog.dismiss();
  });
  return page;
}

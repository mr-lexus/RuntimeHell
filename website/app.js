const dialog = document.querySelector('.lightbox');
let trigger;
for (const link of document.querySelectorAll('[data-lightbox]')) {
  link.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof dialog.showModal !== 'function') return;
    event.preventDefault();
    trigger = link;
    const source = link.querySelector('img');
    const image = dialog.querySelector('img');
    image.src = link.href;
    image.alt = source.alt;
    dialog.querySelector('p').textContent = source.alt;
    dialog.showModal();
    document.documentElement.classList.add('is-modal');
  });
}
dialog.querySelector('button').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  document.documentElement.classList.remove('is-modal');
  trigger?.focus({ preventScroll: true });
});
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('motion-ready');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }, { rootMargin: '0px 0px 70px 0px', threshold: 0.05 });
  for (const element of document.querySelectorAll('.reveal')) observer.observe(element);
}

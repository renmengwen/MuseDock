const buttons = document.querySelectorAll('[data-view]');
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const modalBackdrop = document.querySelector('.modal-backdrop');
const modalTitle = document.querySelector('#modal-title');

function showView(id) {
  views.forEach(view => view.classList.toggle('active', view.id === id));
  navItems.forEach(item => item.classList.toggle('active', item.dataset.view === id));
}

buttons.forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

document.querySelectorAll('[data-modal]').forEach(button => {
  button.addEventListener('click', () => {
    const label = button.closest('.provider-row, .compact-settings')?.querySelector('strong')?.textContent || '设置详情';
    modalTitle.textContent = label;
    modalBackdrop.hidden = false;
  });
});

document.querySelectorAll('.modal-close').forEach(button => {
  button.addEventListener('click', () => {
    modalBackdrop.hidden = true;
  });
});

modalBackdrop.addEventListener('click', event => {
  if (event.target === modalBackdrop) modalBackdrop.hidden = true;
});

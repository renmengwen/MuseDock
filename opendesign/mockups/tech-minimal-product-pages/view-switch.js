const buttons = Array.from(document.querySelectorAll("[data-view]"));
const screens = Array.from(document.querySelectorAll(".screen"));

buttons.forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    buttons.forEach((item) => item.classList.toggle("active", item === button));
    screens.forEach((screen) => screen.classList.toggle("active", screen.id === view));
  });
});

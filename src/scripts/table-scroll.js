// Keep horizontal navigation reachable while reading long tables.
export function mountTableScroll(frame) {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll-wrapper';
  const controls = document.createElement('div');
  controls.className = 'table-scroll-controls';
  const label = document.createElement('label');
  label.htmlFor = `${frame.id}-scroll`;
  const left = document.createElement('button');
  const right = document.createElement('button');
  left.type = right.type = 'button';
  left.textContent = '←';
  right.textContent = '→';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = label.htmlFor;
  slider.min = '0';
  slider.step = '1';
  slider.value = '0';
  for (const control of [left, slider, right]) control.setAttribute('aria-controls', frame.id);
  controls.append(label, left, slider, right);
  frame.before(wrapper);
  wrapper.append(controls, frame);

  function sync() {
    const max = Math.max(0, frame.scrollWidth - frame.clientWidth);
    controls.hidden = frame.hidden || frame.clientWidth === 0 || max <= 1;
    slider.max = String(max);
    slider.value = String(frame.scrollLeft);
    left.disabled = frame.scrollLeft <= 1;
    right.disabled = frame.scrollLeft >= max - 1;
  }
  function move(value) {
    frame.scrollLeft = value;
    sync();
  }
  slider.addEventListener('input', () => move(Number(slider.value)));
  left.addEventListener('click', () => move(Math.max(0, frame.scrollLeft - frame.clientWidth / 2)));
  right.addEventListener('click', () => move(Math.min(Number(slider.max), frame.scrollLeft + frame.clientWidth / 2)));
  frame.addEventListener('scroll', sync, { passive: true });
  const observer = new ResizeObserver(sync);
  let observedTable;
  function update() {
    const en = document.documentElement.lang === 'en';
    const text = en ? 'Scroll table horizontally' : '表を左右に移動';
    if (label.textContent !== text) label.textContent = text;
    left.setAttribute('aria-label', en ? 'Scroll left' : '表を左に移動');
    right.setAttribute('aria-label', en ? 'Scroll right' : '表を右に移動');
    const table = frame.querySelector('table');
    if (table !== observedTable) {
      observer.disconnect();
      observer.observe(frame);
      if (table) observer.observe(table);
      observedTable = table;
    }
    sync();
  }
  update();
  return { update };
}

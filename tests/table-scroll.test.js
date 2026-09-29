import { afterEach, expect, it, vi } from 'vitest';
import { mountTableScroll } from '../src/scripts/table-scroll.js';

afterEach(() => vi.unstubAllGlobals());

it('buttons, slider and native scrolling stay synchronized; fitting and hidden tables omit controls', () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  document.documentElement.lang = 'ja';
  document.body.innerHTML = '<div id="models-table"><table></table></div>';
  const frame = document.querySelector('#models-table');
  Object.defineProperties(frame, {
    clientWidth: { value: 800, configurable: true },
    scrollWidth: { value: 1600, configurable: true },
  });
  const view = mountTableScroll(frame);
  const controls = document.querySelector('.table-scroll-controls');
  const [left, right] = controls.querySelectorAll('button');
  const slider = controls.querySelector('input');
  expect(controls.hidden).toBe(false);
  expect(left.disabled).toBe(true);
  right.click();
  expect(frame.scrollLeft).toBe(400);
  expect(slider.value).toBe('400');
  slider.value = '800';
  slider.dispatchEvent(new Event('input'));
  expect(frame.scrollLeft).toBe(800);
  expect(right.disabled).toBe(true);
  left.click();
  expect(frame.scrollLeft).toBe(400);
  frame.scrollLeft = 0;
  frame.dispatchEvent(new Event('scroll'));
  expect(slider.value).toBe('0');
  expect(left.disabled).toBe(true);
  frame.hidden = true;
  view.update();
  expect(controls.hidden).toBe(true);
  frame.hidden = false;
  document.documentElement.lang = 'en';
  view.update();
  expect(left.getAttribute('aria-label')).toBe('Scroll left');
  Object.defineProperty(frame, 'scrollWidth', { value: 800 });
  view.update();
  expect(controls.hidden).toBe(true);
});

import { decorateOverview } from './region-overview.js';
import { decorateRegionMaps } from './region-map.js';
import { mountTableScroll } from './table-scroll.js';
// Layout enhancements preserve the application's existing data and event handlers.
window.addEventListener('load', () => {
  const $ = selector => document.querySelector(selector);
  const en = () => document.documentElement.lang === 'en';
  const words = (ja, english) => en() ? english : ja;
  const title = $('.brand h1');
  title.removeAttribute('data-i18n');
  title.textContent = 'AWS Bedrock Reference';
  document.title = 'AWS Bedrock Reference';
  const connection = document.createElement('details');
  connection.className = 'connection-details';
  const connectionTitle = document.createElement('summary');
  const connectionBody = document.createElement('div');
  connectionBody.className = 'connection-content';
  connection.append(connectionTitle, connectionBody);
  $('#source-bar').append(connection);
  for (const selector of ['#endpoint-line','#mantle-endpoint-line','#mantle-no-cris']) {
    const node = $(selector);
    if (node) connectionBody.append(node);
  }
  const guide = document.createElement('div');
  guide.className = 'compare-guide';
  const guideIntro = document.createElement('span');
  const guidePrice = document.createElement('span');
  const guideNote = document.createElement('a');
  guideNote.className = 'global-help';
  guideNote.href = 'https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html';
  guideNote.target = '_blank';
  guideNote.rel = 'noreferrer';
  guide.append(guideIntro, guidePrice, guideNote);
  $('#vp-origin .table-frame').before(guide);
  const pickers = new Map();
  const tableScrolls = new Map();
  const columnObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const frame = entry.target.closest('.table-frame');
      frame?.style.setProperty('--measured-provider-width', `${entry.target.getBoundingClientRect().width}px`);
    }
  });
  function enhanceSelect(select) {
    let entry = pickers.get(select);
    if (!entry) {
      const details = document.createElement('details');
      details.className = 'multi-picker';
      const summary = document.createElement('summary');
      const menu = document.createElement('div');
      menu.className = 'multi-menu';
      details.append(summary, menu);
      select.before(details);
      select.hidden = true;
      const label = document.querySelector(`label[for="${select.id}"]`);
      if (label) { label.id = `${select.id}-label`; details.setAttribute('aria-labelledby',label.id); }
      details.addEventListener('toggle', () => {
        if (details.open) for (const value of pickers.values()) if (value.details !== details) value.details.open = false;
      });
      menu.addEventListener('change', event => {
        if (!event.target.matches('input')) return;
        const option = [...select.options].find(option => option.value === event.target.value);
        if (option) { option.selected = event.target.checked; select.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      entry = {details, summary, menu, signature:''};
      pickers.set(select, entry);
    }
    const options = [...select.options];
    const signature = JSON.stringify(options.map(option => [option.value, option.textContent, option.selected])) + en();
    if (signature === entry.signature) return;
    entry.signature = signature;
    const selected = options.filter(option => option.selected);
    entry.summary.textContent = selected.length ? selected.map(option=>option.textContent).join(', ') : words('すべて','All');
    const focused = entry.menu.contains(document.activeElement) ? document.activeElement.value : null;
    entry.menu.replaceChildren();
    for (const option of options) {
      const label = document.createElement('label');
      label.className = 'multi-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = option.value;
      checkbox.checked = option.selected;
      label.append(checkbox,document.createTextNode(option.textContent));
      entry.menu.append(label);
      if (focused === option.value) checkbox.focus();
    }
  }
  const write = (node, value) => { if(node && node.textContent !== value) node.textContent = value; };
  function decorate() {
    observer.disconnect();
    write(connectionTitle, words('接続先と API の情報','Endpoints & APIs'));
    write(guideIntro, words('モデル行を開くと、推論先・ID・記録の所在を確認できます','Expand a model for destinations, IDs and log locations'));
    write(guidePrice, words('価格：USD / 100万トークン（画像・秒などは個別表記）','Prices: USD / 1M tokens (other units shown explicitly)'));
    let priceSortHelp = guide.querySelector('.price-sort-help');
    if (!priceSortHelp) {
      priceSortHelp = document.createElement('span');
      priceSortHelp.className = 'price-sort-help';
      guide.append(priceSortHelp);
    }
    write(priceSortHelp, words('Globalが使えるモデルはGlobal価格、それ以外はIn-Region / Geo価格。表示中のトークン単価で並べ替え、対象単価のない行は末尾。その他の料金は詳細へ。', 'Global prices where available; otherwise In-Region / Geo. Sort by the displayed token price; rows without one go last. Other rates are in details.'));
    write(guideNote, words('Global：世界の対応リージョン。推論先は増えうる ↗','Global: worldwide supported regions; destinations may expand ↗'));
    guide.hidden = $('#vp-origin .table-frame').hidden;
    for(const select of document.querySelectorAll('select[multiple]')) enhanceSelect(select);
    for (const grid of document.querySelectorAll('.detail-panel > .head-grid')) {
      const disclosure = document.createElement('details');
      disclosure.className = 'detail-connection';
      const summary = document.createElement('summary');
      disclosure.append(summary);
      grid.parentElement.append(disclosure);
      disclosure.append(grid);
    }
    for (const summary of document.querySelectorAll('.detail-connection > summary')) {
      write(summary, words('API接続情報', 'API connection details'));
    }
    // A single profile can share the right-hand column with its price table.
    for (const panel of document.querySelectorAll('.lane-panel')) {
      const blocks = panel.querySelectorAll(':scope > .lane-block');
      const price = panel.querySelector(':scope > .detail-price');
      if (blocks.length === 1 && price) blocks[0].append(price);
    }
    // The inherited generic Geo caption incorrectly implies overseas routing even for JP.
    // Keep the destinations and the log-location statement; describe routing neutrally.
    for (const caption of document.querySelectorAll('.flow figcaption')) {
      if (caption.textContent.includes('の外に出ることはあるが')) {
        const sentences = caption.textContent.split('。');
        sentences[0] = '推論は、このプロファイルに定義された推論先のいずれかで実行されます';
        caption.textContent = sentences.join('。');
      }
    }
    for(const [key,ja,english] of [['inRegion','特定リージョン内での推論','Within a specific region'],['geo','特定地理圏内での推論','Within a specific geography'],['global','グローバルでの推論','Across supported regions worldwide']]) {
      const cell = $(`.table-frame th[data-key="${key}"]`);
      if (cell) cell.dataset.description = words(ja,english);
    }
    columnObserver.disconnect();
    for (const cell of document.querySelectorAll('#models-table th.sticky-provider,#regions-matrix th.sticky-1')) columnObserver.observe(cell);
    decorateOverview();
    decorateRegionMaps();
    for (const frame of document.querySelectorAll('#models-table, #regions-matrix')) {
      if (!tableScrolls.has(frame)) tableScrolls.set(frame, mountTableScroll(frame));
      tableScrolls.get(frame).update();
    }
    observer.observe($('#main'),{childList:true,subtree:true});
  }
  const observer = new MutationObserver(decorate);
  decorate();
  document.addEventListener('click',event=>{
    for(const entry of pickers.values()) if(!entry.details.contains(event.target)) entry.details.open=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    for(const entry of pickers.values()) if(entry.details.open){entry.details.open=false;entry.summary.focus();}
  });
});

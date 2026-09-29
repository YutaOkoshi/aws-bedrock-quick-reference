// Called with the presentation observer disconnected to avoid recursive renders.
export const decorateOverview = (() => {
  let context, advanced, advancedSummary, advancedBody, advancedFields, mobileState;
  const mobileQuery=matchMedia("(max-width:768px)");
  mobileQuery.addEventListener("change",()=>decorateOverview());
  const text = (el,value) => { if(el.textContent!==value)el.textContent=value; };
  return () => {
    const en=document.documentElement.lang==='en';
    const t=(ja,english)=>en?english:ja;
    document.title='AWS Bedrock Reference';
    if(!context){
      context=document.createElement('section');context.className='region-overview';
      const origin=document.createElement('div');origin.className='origin-context';
      const bar=document.querySelector('#source-bar');bar.before(context);origin.append(bar);
      const connection=bar.querySelector('.connection-details');
      context.append(origin,connection);
      const callable=document.querySelector('.filter-field:has(#filter-callable)');
      document.querySelector('.filter-summary').append(callable);
      const filterHeading=document.createElement('h2');filterHeading.className='filter-heading';
      const toolbar=document.createElement('div');toolbar.className='model-toolbar';
      toolbar.append(filterHeading,document.querySelector('.row-sort-controls'));
      document.querySelector('#filter-bar').prepend(toolbar);
      advanced=document.createElement('details');advanced.className='advanced-filters';
      advancedSummary=document.createElement('summary');advancedBody=document.createElement('div');advancedBody.className='advanced-filter-fields';
      advanced.append(advancedSummary,advancedBody);document.querySelector('.filter-controls').append(advanced);
      advancedFields=['filter-provider','filter-modality','filter-limit'].map(id=>document.getElementById(id).closest('.filter-field'));
    }
    text(advancedSummary,t('提供元・モダリティ・推論先で絞り込む','Filter by provider, modality or destination'));
    if(mobileState!==mobileQuery.matches){
      mobileState=mobileQuery.matches;
      for(const field of advancedFields)(mobileState?advancedBody:document.querySelector('.filter-controls')).append(field);
      advanced.hidden=!mobileState;
    }
    text(document.querySelector('.filter-heading'),t('モデルを絞り込む','Filter models'));
    const rows=[...document.querySelectorAll('#models-table>table>tbody>tr:not(.detail-row)')];
    const thead=document.querySelector('#models-table>table>thead');
    let groups=thead.querySelector('.column-groups');
    if(!groups){
      groups=document.createElement('tr');groups.className='column-groups';
      for(const span of [3,3,2]){const th=document.createElement('th');th.colSpan=span;th.scope='colgroup';groups.append(th)}
      thead.prepend(groups);
    }
    const labels=[t('モデル','MODEL'),t('推論が実行される場所','INFERENCE LOCATION'),t('価格 · USD','PRICE · USD')];
    [...groups.children].forEach((th,i)=>text(th,labels[i]));
    for(const row of rows){
      const cell=row.querySelector('.sticky-provider');
      if(cell&&!cell.querySelector('.provider-text')){
        const names=[...cell.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
        for(const node of names){const span=document.createElement('span');span.className='provider-text';span.textContent=node.textContent;node.replaceWith(span)}
      }
    }
  };
})();

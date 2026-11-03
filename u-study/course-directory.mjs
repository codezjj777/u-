// Read the course directory, never a resume/continue-learning shortcut.
export function collectDirectoryFromDOM() {
  const visible=el=>!!(el&&!el.closest('[hidden],[class*="unipus-tabs_itemHidden"],.ant-collapse-content-hidden')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const tabs=[...document.querySelectorAll('[class*="courses-unit_unitTabBody"] [class*="unipus-tabs_tabItemContainer"]')].filter(visible);
  const units=tabs.map(el=>({id:el.id,label:clean(el.querySelector('[title]')?.getAttribute('title')||el.textContent),selector:`[id=${JSON.stringify(el.id)}]`,active:el.className.includes('unipus-tabs_tabActive')})).filter(unit=>unit.id&&unit.label);
  const active=units.filter(unit=>unit.active);
  const bodies=[...document.querySelectorAll('#tab-unit-body-container > [class*="unipus-tabs_itemActive"]')].filter(visible);
  const loading=[...document.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible);
  const login=[...document.querySelectorAll('input[type=password]')].some(visible);
  const account=clean(document.querySelector('[class*="header_avatar"]')?.textContent);
  const empty={units,account,activeUnitId:active.length===1?active[0].id:'',loading,login,entries:[],collapsed:[],ready:false,fingerprint:''};
  if(active.length!==1||bodies.length!==1)return empty;
  const body=bodies[0],entries=[],collapsed=[];
  // Fresh markers are only used after matching the full chapter identity again.
  for(const el of document.querySelectorAll('[data-ustudy-directory-row],[data-ustudy-directory-expand]')){el.removeAttribute('data-ustudy-directory-row');el.removeAttribute('data-ustudy-directory-expand');}
  for(const header of body.querySelectorAll('.ant-collapse-header[aria-expanded="false"]')){
    if(!visible(header))continue;
    header.setAttribute('data-ustudy-directory-expand',String(collapsed.length));
    collapsed.push({selector:`[data-ustudy-directory-expand="${collapsed.length}"]`,title:clean(header.textContent)});
  }
  for(const row of body.querySelectorAll('[class*="courses-unit_taskItemContainer"]')){
    if(!visible(row))continue;
    const title=clean(row.querySelector('[class*="courses-unit_taskTypeName"]')?.textContent);
    if(!title)continue;
    const path=[];
    for(let parent=row.parentElement;parent&&parent!==body;parent=parent.parentElement){
      if(parent.classList.contains('ant-collapse-item')){
        const header=[...parent.children].find(el=>el.classList.contains('ant-collapse-header'));
        if(header)path.unshift(clean(header.textContent));
      }
    }
    const requiredLabel=clean(row.querySelector('[class*="courses-unit_taskRequireIcon"]')?.textContent);
    const required=requiredLabel==='必修';
    const status=clean(row.querySelector('[class*="courses-unit_nodePassStateTip"]')?.textContent);
    const key=JSON.stringify([active[0].id,path,title]);
    const completed=status==='已完成';
    const pending=/^(未开始|进行中|学习中|未完成)$/.test(status);
    row.setAttribute('data-ustudy-directory-row',String(entries.length));
    // At narrow widths the progress column can overlap even the title.
    // Its left-hand dot belongs to the same clickable name container.
    const stateBounds=row.querySelector('[class*="courses-unit_taskStateContainer"]')?.getBoundingClientRect?.();
    const dot=row.querySelector('[class*="courses-unit_taskDian"]'),dotBounds=dot?.getBoundingClientRect?.();
    const clearDot=dotBounds?.width>0&&(!stateBounds||dotBounds.right<=stateBounds.left);
    // The title's own hover-tooltip layer can also intercept pointer events.
    // Prefer the clear dot even when the progress column does not overlap.
    const clickClass=clearDot?'courses-unit_taskDian':'courses-unit_taskTypeName';
    entries.push({key,title,path,required,requiredLabel,status,completed,pending,rowText:clean(row.textContent).slice(0,500),selector:`[data-ustudy-directory-row="${entries.length}"] [class*="${clickClass}"]`});
  }
  const heading=clean(body.querySelector('[class*="courses-unit_unitNameLabel"]')?.textContent);
  // U校园 first renders every row as locked, then hydrates the requirements
  // and progress. That placeholder must not become a zero-required result.
  const allLocked=entries.length>0&&entries.every(entry=>entry.status==='已锁定');
  return {...empty,heading,entries,collapsed,allLocked,ready:!loading&&!allLocked&&entries.length>0&&collapsed.length===0,fingerprint:JSON.stringify([heading,entries.map(e=>[e.path,e.title,e.required,e.status])])};
}

export function summarizeDirectory(directory) {
  const required=directory.entries.filter(entry=>entry.required);
  return {required:required.length,completed:required.filter(entry=>entry.completed).length,pending:required.filter(entry=>entry.pending).length,unknown:required.filter(entry=>!entry.completed&&!entry.pending).length};
}

export function requiredQueue(directory,unitId) {
  if(!directory.ready||directory.activeUnitId!==unitId)throw new Error('所选单元的目录尚未完整载入。');
  const counts=new Map();for(const entry of directory.entries)counts.set(entry.key,(counts.get(entry.key)||0)+1);
  if(directory.entries.some(entry=>entry.required&&counts.get(entry.key)>1))throw new Error('目录中存在同路径同名的必修项目，无法可靠区分，已停止。');
  return directory.entries.filter(entry=>entry.required&&entry.pending);
}

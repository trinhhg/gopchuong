// CONFIG
const DB_NAME = 'AutoPilotV23'; 
const DB_VERSION = 2;
let db = null;
let files = [];
let folders = [];
let historyLogs = [];
let checklists = {};
let currentFolderId = 'root';
let currentView = 'manager';
let previewFileId = null;

// --- HELPERS ---
function countWords(text) { if (!text || !text.trim()) return 0; return text.trim().split(/\s+/).length; }
function getChapterNum(title) { const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i); return match ? parseFloat(match[1]) : Date.now(); }
function cleanContent(text) { return text.split('\n').map(l => l.trim()).filter(l => l.length > 0); }

// --- DOM ELEMENTS ---
const els = {
    folderSelect: document.getElementById('folderSelect'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDeleteFolder: document.getElementById('btnDeleteFolder'),
    searchInput: document.getElementById('searchInput'),
    
    // Views
    btnViewFiles: document.getElementById('btnViewFiles'),
    btnViewHistory: document.getElementById('btnViewHistory'),
    btnViewChecklist: document.getElementById('btnViewChecklist'),
    viewManager: document.getElementById('viewManager'),
    viewHistory: document.getElementById('viewHistory'),
    viewChecklist: document.getElementById('viewChecklist'),
    
    // Manager
    fileGrid: document.getElementById('fileGrid'),
    fileCount: document.getElementById('fileCount'),
    selectAll: document.getElementById('selectAll'),
    btnDownloadBatch: document.getElementById('btnDownloadBatch'),
    btnDownloadDirect: document.getElementById('btnDownloadDirect'),
    btnDeleteBatch: document.getElementById('btnDeleteBatch'),
    
    // History
    historyFilter: document.getElementById('historyFilter'),
    historyTableBody: document.getElementById('historyTableBody'),
    emptyHistory: document.getElementById('emptyHistory'),
    btnClearHistory: document.getElementById('btnClearHistory'),
    
    // Checklist
    checklistBody: document.getElementById('checklistBody'),
    btnClearChecklist: document.getElementById('btnClearChecklist'),
    progCount: document.getElementById('progCount'),
    progBar: document.getElementById('progBar'),
    btnImportChecklist: document.getElementById('btnImportChecklist'),
    checklistInput: document.getElementById('checklistInput'),
    
    // Logic
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'),
    btnMerge: document.getElementById('btnMerge'),
    editor: document.getElementById('editor'),
    
    // Modal
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewDocHeader: document.getElementById('previewDocHeader'),
    previewBody: document.getElementById('previewBody'),
    
    toast: document.getElementById('toast')
};

// --- LOGGING ---
function addToLog(msg, type = 'success') {
    const now = new Date();
    const time = now.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const logItem = { id: Date.now(), time: time, msg: msg, type: type, timestamp: now.getTime() };
    
    historyLogs.unshift(logItem);
    saveDB('history', logItem);
    
    // Giới hạn 500 log
    if(historyLogs.length > 500) { 
        const removed = historyLogs.pop(); 
        delDB('history', removed.id); 
    }
    
    // Luôn render nếu đang ở tab History
    if(currentView === 'history') renderHistory();
}

function renderHistory() {
    const keyword = els.searchInput.value.toLowerCase();
    const filterType = els.historyFilter.value; 
    
    const filtered = historyLogs.filter(log => {
        const matchSearch = log.msg.toLowerCase().includes(keyword);
        const matchType = filterType === 'all' || log.type === filterType;
        return matchSearch && matchType;
    });
    
    els.historyTableBody.innerHTML = '';
    
    if(filtered.length === 0) {
        els.emptyHistory.style.display = 'block';
    } else {
        els.emptyHistory.style.display = 'none';
        filtered.forEach(log => {
            const tr = document.createElement('tr');
            let statusClass = 'success';
            let statusText = 'THÀNH CÔNG';
            
            if(log.type === 'warn') { statusClass = 'warn'; statusText = 'CẢNH BÁO'; }
            if(log.type === 'info') { statusClass = 'info'; statusText = 'THÔNG TIN'; }

            tr.innerHTML = `
                <td>${log.time}</td>
                <td><span class="badge-status ${statusClass}">${statusText}</span></td>
                <td>${log.msg}</td>
            `;
            els.historyTableBody.appendChild(tr);
        });
    }
}

// --- INIT APP ---
async function init() {
    await initDB();
    localStorage.setItem('is_merging_busy', 'false'); // Reset trạng thái queue

    // Events
    els.btnNewFolder.onclick = createFolder;
    els.btnDeleteFolder.onclick = deleteCurrentFolder;
    els.folderSelect.onchange = (e) => { currentFolderId = e.target.value; switchView(currentView); };

    els.btnViewFiles.onclick = () => switchView('manager');
    els.btnViewHistory.onclick = () => switchView('history');
    els.btnViewChecklist.onclick = () => switchView('checklist');

    els.searchInput.oninput = () => {
        if(currentView === 'manager') renderFiles();
        else renderHistory();
    };

    // --- LOGIC NHẬP DANH SÁCH (CÓ CHECK TRÙNG) ---
    els.btnImportChecklist.onclick = () => {
        try {
            const raw = els.checklistInput.value;
            if(!raw) return;
            const newItems = JSON.parse(raw);
            
            // 1. KIỂM TRA TRÙNG TRONG DANH SÁCH QUÉT
            const seen = new Set();
            const duplicates = new Set();
            
            newItems.forEach(item => {
                if(seen.has(item.num)) {
                    duplicates.add(item.num);
                } else {
                    seen.add(item.num);
                }
            });

            // Ghi Log Kết Quả
            if(duplicates.size > 0) {
                const dupList = Array.from(duplicates).join(', ');
                addToLog(`⚠️ Phát hiện trùng: Chương ${dupList}`, 'warn');
                toast(`Có ${duplicates.size} chương trùng! Xem lịch sử.`, 'warn');
            } else {
                addToLog(`✅ Danh sách hợp lệ (Không trùng)`, 'success');
            }

            // 2. LƯU VÀO DB
            let currentList = checklists[currentFolderId] || [];
            let addedCount = 0;
            
            newItems.forEach(item => {
                if(!currentList.find(x => x.num === item.num)) {
                    currentList.push(item);
                    addedCount++;
                }
            });
            
            currentList.sort((a,b) => a.num - b.num);
            checklists[currentFolderId] = currentList;
            saveDB('checklists', {folderId: currentFolderId, list: currentList});
            
            if(addedCount > 0) addToLog(`Đã thêm ${addedCount} mục vào danh sách theo dõi`, 'info');
            
            // 3. TỰ ĐỘNG CHUYỂN SANG TAB LỊCH SỬ ĐỂ XEM BÁO CÁO
            switchView('history'); 
            
        } catch(e) { console.error(e); toast("Lỗi nhập danh sách"); }
    };

    els.btnClearChecklist.onclick = () => {
        if(confirm("Xóa danh sách theo dõi?")) {
            delete checklists[currentFolderId];
            delDB('checklists', currentFolderId);
            renderChecklist();
        }
    };

    els.historyFilter.onchange = renderHistory;
    els.selectAll.onchange = (e) => {
        const list = getFilteredFiles();
        list.forEach(f => f.selected = e.target.checked);
        renderFiles();
    };
    els.btnDownloadBatch.onclick = downloadBatchZip;
    els.btnDownloadDirect.onclick = downloadBatchDirect;
    els.btnDeleteBatch.onclick = deleteBatch;
    els.btnClearHistory.onclick = () => {
        if(confirm("Xóa toàn bộ lịch sử?")) { historyLogs=[]; clearStore('history'); renderHistory(); toast("Đã xóa lịch sử"); }
    };

    // Queue Merge Trigger
    els.btnMerge.onclick = () => {
        const payload = {
            title: els.chapterTitle.value,
            content: els.editor.value,
            autoGroup: els.autoGroup.checked
        };
        els.editor.value = ''; 
        mergeQueue.push(payload);
        processQueue();
    };
    
    document.addEventListener('keydown', e => {
        if(els.previewModal.classList.contains('show')) {
            if(e.key === 'ArrowLeft') prevChapter();
            if(e.key === 'ArrowRight') nextChapter();
            if(e.key === 'Escape') closePreview();
        }
    });
}

// --- QUEUE PROCESSOR ---
let mergeQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue) return;
    if (mergeQueue.length === 0) {
        localStorage.setItem('is_merging_busy', 'false');
        return;
    }
    isProcessingQueue = true;
    localStorage.setItem('is_merging_busy', 'true');

    try {
        const task = mergeQueue.shift();
        await performMerge(task);
    } catch (e) {
        console.error(e);
    } finally {
        isProcessingQueue = false;
        setTimeout(processQueue, 10);
    }
}

// --- MERGE LOGIC ---
async function performMerge(task) {
    const { title: inputTitle, content, autoGroup } = task;
    if(!content.trim()) return;

    const groupMatch = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)(?:\.\d+)?(.*)/i);
    let fileName, headerInDoc;

    if (autoGroup && groupMatch) {
        const mainNum = groupMatch[1]; 
        const titleSuffix = groupMatch[2] ? groupMatch[2].trim() : "";
        let baseName = `Chương ${mainNum}`;
        if(titleSuffix) baseName += ` ${titleSuffix}`;
        
        let safeFileName = baseName.replace(/[:*?"<>|]/g, " -").replace(/\s+-\s+/, " - ");
        fileName = `${safeFileName}.docx`;
        headerInDoc = baseName.replace(/\s+:/, ":"); 
    } else {
        let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
        fileName = `${safeName}.docx`;
        headerInDoc = inputTitle;
    }

    const lines = cleanContent(content);
    if(lines.length === 0) return;

    const chapterNum = getChapterNum(inputTitle);
    let segment = { idSort: chapterNum, lines: lines, header: inputTitle };

    let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

    if(targetFile) {
        if(!targetFile.segments) targetFile.segments = [];
        const existingIndex = targetFile.segments.findIndex(s => s.idSort === chapterNum);
        
        if (existingIndex !== -1) {
            targetFile.segments[existingIndex] = segment;
            addToLog(`Cập nhật: ${inputTitle}`, 'warn');
        } else {
            targetFile.segments.push(segment);
            addToLog(`Gộp thêm: ${inputTitle}`, 'success');
        }

        targetFile.segments.sort((a,b) => a.idSort - b.idSort);
        let allText = "";
        targetFile.segments.forEach(seg => { allText += seg.lines.join('\n') + '\n'; });

        if(!targetFile.headerInDoc || targetFile.headerInDoc.includes("Chương Mới")) {
            targetFile.headerInDoc = headerInDoc;
        }

        targetFile.wordCount = countWords(targetFile.headerInDoc + " " + allText);
        targetFile.timestamp = Date.now();
        targetFile.blob = await generateDocxFromSegments(targetFile.headerInDoc, targetFile.segments);
        saveDB('files', targetFile);
    } else {
        const wc = countWords(headerInDoc + " " + content);
        targetFile = {
            id: Date.now(), name: fileName, folderId: currentFolderId,
            segments: [segment],
            headerInDoc: headerInDoc,
            wordCount: wc, timestamp: Date.now(), selected: false
        };
        targetFile.blob = await generateDocxFromSegments(headerInDoc, targetFile.segments);
        files.push(targetFile);
        saveDB('files', targetFile);
        
        addToLog(`Tạo file mới: ${fileName}`, 'info');
        addToLog(`Gộp thêm: ${inputTitle}`, 'success');
    }

    // Refresh UI
    if(currentView === 'manager') renderFiles();
    if(currentView === 'checklist') renderChecklist();
}

// --- DB & UTILS ---
function initDB() {
    return new Promise(resolve => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if(!d.objectStoreNames.contains('files')) d.createObjectStore('files', {keyPath: 'id'});
            if(!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', {keyPath: 'id'});
            if(!d.objectStoreNames.contains('history')) d.createObjectStore('history', {keyPath: 'id'});
            if(!d.objectStoreNames.contains('checklists')) d.createObjectStore('checklists', {keyPath: 'folderId'});
        };
        req.onsuccess = e => { db = e.target.result; loadData().then(resolve); };
    });
}
function getAll(s) { return new Promise(r => db.transaction(s,'readonly').objectStore(s).getAll().onsuccess=e=>r(e.target.result||[])); }
function saveDB(s, i) { db.transaction(s,'readwrite').objectStore(s).put(i); }
function delDB(s, id) { db.transaction(s,'readwrite').objectStore(s).delete(id); }
function clearStore(s) { const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear(); }

function switchView(view) {
    currentView = view;
    [els.btnViewFiles, els.btnViewHistory, els.btnViewChecklist].forEach(b => b.classList.remove('active'));
    [els.viewManager, els.viewHistory, els.viewChecklist].forEach(v => v.classList.remove('active'));
    
    if(view === 'manager') {
        els.btnViewFiles.classList.add('active'); els.viewManager.classList.add('active');
        renderFiles();
    } else if(view === 'history') {
        els.btnViewHistory.classList.add('active'); els.viewHistory.classList.add('active');
        renderHistory();
    } else if(view === 'checklist') {
        els.btnViewChecklist.classList.add('active'); els.viewChecklist.classList.add('active');
        renderChecklist();
    }
}

function renderFolders() {
    els.folderSelect.innerHTML = '';
    folders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id; opt.innerText = f.name;
        if(f.id === currentFolderId) opt.selected = true;
        els.folderSelect.appendChild(opt);
    });
}
function createFolder() { const n = prompt("Tên:"); if(n) { const f = {id: Date.now().toString(), name: n}; folders.push(f); saveDB('folders', f); currentFolderId = f.id; renderFolders(); renderFiles(); switchView(currentView); } }
function deleteCurrentFolder() { if(currentFolderId === 'root') return toast("Lỗi: Root"); if(confirm("Xóa?")) { files.filter(f=>f.folderId===currentFolderId).forEach(f=>delDB('files',f.id)); files = files.filter(f=>f.folderId!==currentFolderId); delDB('folders', currentFolderId); folders = folders.filter(f=>f.id!==currentFolderId); currentFolderId = 'root'; renderFolders(); renderFiles(); switchView(currentView); } }
function getFilteredFiles() { let list = files.filter(f => f.folderId === currentFolderId); if(currentView === 'manager') { const keyword = els.searchInput.value.toLowerCase().trim(); if(keyword) list = list.filter(f => f.name.toLowerCase().includes(keyword)); } list.sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name)); return list; }

function renderFiles() {
    const list = getFilteredFiles();
    els.fileCount.innerText = list.length;
    els.fileGrid.innerHTML = '';
    list.forEach(f => {
        let displayName = f.name.replace(/\.docx$/i, '');
        const shortMatch = displayName.match(/^(Chương|Chapter|Hồi)\s+(\d+(\.\d+)?)/i);
        if (shortMatch) displayName = `${shortMatch[1]} ${shortMatch[2]}`;

        const card = document.createElement('div');
        card.className = `file-card ${f.selected ? 'selected' : ''}`;
        card.onclick = (e) => { if(e.target.closest('.card-actions')||e.target.closest('.card-body')) return; f.selected = !f.selected; renderFiles(); };
        card.innerHTML = `
            <div class="card-header"><input type="checkbox" class="card-chk" ${f.selected?'checked':''}><div class="card-icon">📄</div></div>
            <div class="card-body" title="${f.name}"><div class="file-name">${displayName}</div><div class="file-info"><span class="tag-wc">${f.wordCount} words</span></div></div>
            <div class="card-actions"><button class="btn-small view" onclick="event.stopPropagation(); openPreview(${f.id})">👁 Xem</button><button class="btn-small del" onclick="event.stopPropagation(); deleteOne(${f.id})">🗑 Xóa</button></div>
        `;
        const chk = card.querySelector('.card-chk'); chk.onclick=e=>e.stopPropagation(); chk.onchange=()=>{f.selected=chk.checked;renderFiles();}; card.querySelector('.card-body').onclick=e=>{e.stopPropagation();openPreview(f.id);}; els.fileGrid.appendChild(card);
    });
}

function renderChecklist() {
    const list = checklists[currentFolderId] || [];
    const currentFiles = files.filter(f => f.folderId === currentFolderId);
    const doneChapters = new Set();
    currentFiles.forEach(f => { if(f.segments && f.segments.length > 0) f.segments.forEach(s => doneChapters.add(s.idSort)); else doneChapters.add(getChapterNum(f.name)); });
    els.checklistBody.innerHTML = '';
    let doneCount = 0;
    if(list.length === 0) els.checklistBody.innerHTML = '<div class="empty-state">Chưa có dữ liệu.</div>';
    else {
        const frag = document.createDocumentFragment();
        list.forEach(item => {
            const isDone = doneChapters.has(item.num);
            if(isDone) doneCount++;
            const div = document.createElement('div');
            div.className = `cl-item ${isDone ? 'done' : ''}`;
            div.innerHTML = `<div class="col-status">${isDone?'✅ Đã xong':'⏱️ Chưa gộp'}</div><div class="col-title">${item.title}</div><div class="col-num">#${item.num}</div>`;
            frag.appendChild(div);
        });
        els.checklistBody.appendChild(frag);
    }
    els.progCount.innerText = `${doneCount}/${list.length}`;
    els.progBar.style.width = `${(list.length>0?(doneCount/list.length)*100:0)}%`;
}

function generateDocxFromSegments(mainHeader, segments) { const { Document, Packer, Paragraph, TextRun } = docx; const children = []; children.push(new Paragraph({children: [new TextRun({text: mainHeader, font: "Calibri", size: 32, color: "000000"})], spacing: {after: 240}})); children.push(new Paragraph({text: "", spacing: {after: 240}})); segments.forEach(seg => { seg.lines.forEach(line => { children.push(new Paragraph({children: [new TextRun({text: line, font: "Calibri", size: 32, color: "000000"})], spacing: {after: 240}})); }); }); return Packer.toBlob(new Document({sections:[{children}]})); }
window.openPreview = (id) => { const f = files.find(x=>x.id===id); if(!f) return; previewFileId = id; const list = getFilteredFiles(); const idx = list.findIndex(x=>x.id===id); els.previewTitle.innerText = f.name; document.querySelector('.modal-nav span').innerText = `${idx+1}/${list.length}`; els.previewDocHeader.innerText = f.headerInDoc; let content = ""; if(f.segments) f.segments.forEach(seg => seg.lines.forEach(l => content += `<p>${l}</p>`)); else content = f.rawContent.split('\n').map(l=>`<p>${l}</p>`).join(''); els.previewBody.innerHTML = content; els.previewModal.classList.add('show'); };
window.closePreview = () => els.previewModal.classList.remove('show');
window.prevChapter = () => navChapter(-1);
window.nextChapter = () => navChapter(1);
function navChapter(d) { const l = getFilteredFiles(); const i = l.findIndex(x=>x.id===previewFileId); if(i!==-1 && l[i+d]) openPreview(l[i+d].id); else toast(d>0?"Hết":"Đầu"); }
window.downloadOne = (id) => { const f=files.find(x=>x.id===id); if(f&&f.blob) saveAs(f.blob, f.name); };
window.deleteOne = (id) => { if(confirm('Xóa?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderFiles(); } };
function deleteBatch() { const s = getFilteredFiles().filter(f=>f.selected); if(confirm(`Xóa ${s.length}?`)) { s.forEach(f=>delDB('files',f.id)); files=files.filter(f=>!f.selected || f.folderId!==currentFolderId); renderFiles(); } }
function downloadBatchZip() { const s = getFilteredFiles().filter(f=>f.selected); if(!s.length) return toast("Chưa chọn"); const z = new JSZip(); s.forEach(f=>z.file(f.name, f.blob)); z.generateAsync({type:"blob"}).then(c=>saveAs(c, `Batch_${Date.now()}.zip`)); }
async function downloadBatchDirect() { const s = getFilteredFiles().filter(f=>f.selected); if(!s.length) return toast("Chưa chọn"); toast(`Tải ${s.length} file...`); for(let i=0;i<s.length;i++) { if(s[i].blob) { saveAs(s[i].blob, s[i].name); await new Promise(r=>setTimeout(r,200)); } } }
function toast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

// CONFIG
const DB_NAME = 'AutoPilotV22'; // Nâng version DB để tạo bảng History mới
const DB_VERSION = 1;
let db = null;
let files = [];
let folders = [];
let historyLogs = []; // Lưu trong RAM để hiển thị
let currentFolderId = 'root';
let currentView = 'manager';
let previewFileId = null;

// --- HELPERS ---
function countWords(text) { if (!text || !text.trim()) return 0; return text.trim().split(/\s+/).length; }
function getChapterNum(title) { const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i); return match ? parseFloat(match[1]) : Date.now(); }
function cleanContent(text) { return text.split('\n').map(l => l.trim()).filter(l => l.length > 0); }

// --- DOM ---
const els = {
    folderSelect: document.getElementById('folderSelect'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDeleteFolder: document.getElementById('btnDeleteFolder'),
    searchInput: document.getElementById('searchInput'),
    
    btnViewFiles: document.getElementById('btnViewFiles'),
    btnViewHistory: document.getElementById('btnViewHistory'),
    viewManager: document.getElementById('viewManager'),
    viewHistory: document.getElementById('viewHistory'),
    
    fileGrid: document.getElementById('fileGrid'),
    fileCount: document.getElementById('fileCount'),
    selectAll: document.getElementById('selectAll'),
    btnDownloadBatch: document.getElementById('btnDownloadBatch'),
    btnDownloadDirect: document.getElementById('btnDownloadDirect'),
    btnDeleteBatch: document.getElementById('btnDeleteBatch'),
    
    historyFilter: document.getElementById('historyFilter'),
    historyTableBody: document.getElementById('historyTableBody'),
    emptyHistory: document.getElementById('emptyHistory'),
    btnClearHistory: document.getElementById('btnClearHistory'),
    
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'),
    btnMerge: document.getElementById('btnMerge'),
    editor: document.getElementById('editor'),
    
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewDocHeader: document.getElementById('previewDocHeader'),
    previewBody: document.getElementById('previewBody'),
    
    toast: document.getElementById('toast')
};

// --- LOGGING SYSTEM (LƯU DB) ---
function addToLog(msg, type = 'success') {
    const now = new Date();
    const time = now.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    
    const logItem = {
        id: Date.now(), // Unique ID
        time: time,
        msg: msg,
        type: type,
        timestamp: now.getTime() // Để sort
    };

    // 1. Lưu vào Array RAM
    historyLogs.unshift(logItem);
    
    // 2. Lưu vào IndexedDB (Để F5 không mất)
    saveDB('history', logItem);

    // 3. Giới hạn hiển thị và lưu trữ (Giữ 500 dòng mới nhất)
    if(historyLogs.length > 500) {
        const removed = historyLogs.pop();
        delDB('history', removed.id); // Xóa trong DB luôn cho nhẹ
    }
    
    // 4. Render nếu đang xem
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
            tr.innerHTML = `
                <td>${log.time}</td>
                <td><span class="badge-status ${log.type}">${log.type.toUpperCase()}</span></td>
                <td>${log.msg}</td>
            `;
            els.historyTableBody.appendChild(tr);
        });
    }
}

// --- VIEW SWITCHING ---
function switchView(view) {
    currentView = view;
    if(view === 'manager') {
        els.btnViewFiles.classList.add('active');
        els.btnViewHistory.classList.remove('active');
        els.viewManager.classList.add('active');
        els.viewHistory.classList.remove('active');
        renderFiles();
    } else {
        els.btnViewHistory.classList.add('active');
        els.btnViewFiles.classList.remove('active');
        els.viewHistory.classList.add('active');
        els.viewManager.classList.remove('active');
        renderHistory();
    }
    els.searchInput.value = '';
    els.searchInput.placeholder = view === 'manager' ? "Tìm tên file..." : "Tìm nhật ký...";
}

// --- DB INIT ---
function initDB() {
    return new Promise(resolve => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if(!d.objectStoreNames.contains('files')) d.createObjectStore('files', {keyPath: 'id'});
            if(!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', {keyPath: 'id'});
            // THÊM BẢNG HISTORY
            if(!d.objectStoreNames.contains('history')) d.createObjectStore('history', {keyPath: 'id'});
        };
        req.onsuccess = e => { db = e.target.result; loadData().then(resolve); };
    });
}

async function loadData() {
    // Load Files & Folders
    files = await getAll('files');
    folders = await getAll('folders');
    
    // Load History & Sort (Mới nhất lên đầu)
    const logs = await getAll('history');
    historyLogs = logs.sort((a,b) => b.timestamp - a.timestamp);

    if(!folders.find(f=>f.id==='root')) {
        folders.push({id:'root', name:'Thư mục chính'});
        saveDB('folders', {id:'root', name:'Thư mục chính'});
    }
    renderFolders();
    renderFiles();
}

// --- UTILS DB ---
function getAll(s) { return new Promise(r => db.transaction(s,'readonly').objectStore(s).getAll().onsuccess=e=>r(e.target.result||[])); }
function saveDB(s, i) { db.transaction(s,'readwrite').objectStore(s).put(i); }
function delDB(s, id) { db.transaction(s,'readwrite').objectStore(s).delete(id); }
function clearStore(s) { 
    const tx = db.transaction(s, 'readwrite');
    tx.objectStore(s).clear();
}

// --- INIT APP ---
async function init() {
    await initDB();
    
    els.btnNewFolder.onclick = createFolder;
    els.btnDeleteFolder.onclick = deleteCurrentFolder;
    els.folderSelect.onchange = (e) => { currentFolderId = e.target.value; renderFiles(); };

    els.btnViewFiles.onclick = () => switchView('manager');
    els.btnViewHistory.onclick = () => switchView('history');
    
    els.searchInput.oninput = () => {
        if(currentView === 'manager') renderFiles();
        else renderHistory();
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
    
    // Clear History Button
    els.btnClearHistory.onclick = () => {
        if(confirm("Xóa toàn bộ lịch sử?")) {
            historyLogs = [];
            clearStore('history'); // Xóa trong DB
            renderHistory();
            toast("Đã xóa sạch lịch sử");
        }
    };

    els.btnMerge.onclick = () => merge(true);
    
    document.addEventListener('keydown', e => {
        if(els.previewModal.classList.contains('show')) {
            if(e.key === 'ArrowLeft') prevChapter();
            if(e.key === 'ArrowRight') nextChapter();
            if(e.key === 'Escape') closePreview();
        }
    });
}

// --- MERGE LOGIC (DUAL LOGGING) ---
async function merge(autoClear) {
    const content = els.editor.value;
    if(!content.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeName}.docx`;
    
    // Log kỹ thuật (ẩn bớt nếu cần, ở đây để info)
    // addToLog(`Nhận tín hiệu: ${inputTitle}`, 'info');

    const lines = cleanContent(content);
    if(lines.length === 0) return;

    const chapterNum = getChapterNum(inputTitle);
    let segment = { idSort: chapterNum, lines: lines, header: inputTitle };

    if(els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if(match) fileName = `Chương ${match[1]}.docx`;
    }

    let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

    if(targetFile) {
        if(!targetFile.segments) targetFile.segments = [];
        
        const existingIndex = targetFile.segments.findIndex(s => s.idSort === chapterNum);
        
        if (existingIndex !== -1) {
            // Update
            targetFile.segments[existingIndex] = segment;
            addToLog(`Cập nhật nội dung: ${inputTitle}`, 'warn'); // Màu cam cho update
            toast(`Cập nhật: ${inputTitle}`);
        } else {
            // Append
            targetFile.segments.push(segment);
            // LOG QUAN TRỌNG: Gộp thêm
            addToLog(`Gộp thêm: ${inputTitle}`, 'success'); 
            toast(`Gộp thêm: ${inputTitle}`);
        }

        targetFile.segments.sort((a,b) => a.idSort - b.idSort);
        
        // Rebuild content
        let allText = "";
        targetFile.segments.forEach(seg => { allText += seg.lines.join('\n') + '\n'; });

        targetFile.headerInDoc = targetFile.name.replace('.docx','');
        targetFile.wordCount = countWords(targetFile.headerInDoc + " " + allText);
        targetFile.timestamp = Date.now();
        
        targetFile.blob = await generateDocxFromSegments(targetFile.headerInDoc, targetFile.segments);
        saveDB('files', targetFile);
        
    } else {
        // CREATE NEW FILE
        const wc = countWords(inputTitle + " " + content);
        targetFile = {
            id: Date.now(), name: fileName, folderId: currentFolderId,
            segments: [segment],
            headerInDoc: inputTitle,
            wordCount: wc, timestamp: Date.now(), selected: false
        };
        targetFile.blob = await generateDocxFromSegments(inputTitle, targetFile.segments);
        files.push(targetFile);
        saveDB('files', targetFile);
        
        // LOG KÉP CHO TRƯỜNG HỢP TẠO MỚI TỪ SUB-CHAPTER
        // Log 1: Báo tạo file gốc
        addToLog(`Tạo file mới: ${fileName}`, 'info'); 
        
        // Log 2: Báo chính xác chương nào vừa được nhét vào
        // Ví dụ: fileName là "Chương 1.docx", inputTitle là "Chương 1.1"
        // Thì log này xác nhận Chương 1.1 đã nằm trong file Chương 1
        addToLog(`Gộp thêm: ${inputTitle}`, 'success');
        
        toast(`Đã tạo: ${fileName}`);
    }

    const numMatch = inputTitle.match(/(\d+)(\.(\d+))?/);
    if(numMatch) {
        if(numMatch[2]) els.chapterTitle.value = inputTitle.replace(numMatch[0], `${numMatch[1]}.${parseInt(numMatch[3])+1}`);
        else els.chapterTitle.value = inputTitle.replace(numMatch[1], parseInt(numMatch[1])+1);
    }

    if(autoClear) els.editor.value = '';
    if(currentView === 'manager') renderFiles();
}

function generateDocxFromSegments(mainHeader, segments) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const children = [];
    children.push(new Paragraph({children: [new TextRun({text: mainHeader, font: "Calibri", size: 32, color: "000000"})], spacing: {after: 240}}));
    children.push(new Paragraph({text: "", spacing: {after: 240}}));
    segments.forEach(seg => {
        seg.lines.forEach(line => {
            children.push(new Paragraph({children: [new TextRun({text: line, font: "Calibri", size: 32, color: "000000"})], spacing: {after: 240}}));
        });
    });
    return Packer.toBlob(new Document({sections:[{children}]}));
}

function getFilteredFiles() {
    let list = files.filter(f => f.folderId === currentFolderId);
    if(currentView === 'manager') {
        const keyword = els.searchInput.value.toLowerCase().trim();
        if(keyword) list = list.filter(f => f.name.toLowerCase().includes(keyword));
    }
    list.sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name));
    return list;
}

function renderFiles() {
    const list = getFilteredFiles();
    els.fileCount.innerText = list.length;
    els.fileGrid.innerHTML = '';
    list.forEach(f => {
        const card = document.createElement('div');
        card.className = `file-card ${f.selected ? 'selected' : ''}`;
        card.onclick = (e) => {
            if(e.target.closest('.card-actions') || e.target.closest('.card-body')) return;
            f.selected = !f.selected; renderFiles();
        };
        card.innerHTML = `
            <div class="card-header"><input type="checkbox" class="card-chk" ${f.selected?'checked':''}><div class="card-icon">📄</div></div>
            <div class="card-body" title="Xem trước"><div class="file-name">${f.name}</div><div class="file-info"><span class="tag-wc">${f.wordCount} words</span></div></div>
            <div class="card-actions"><button class="btn-small view" onclick="event.stopPropagation(); openPreview(${f.id})">👁 Xem</button><button class="btn-small del" onclick="event.stopPropagation(); deleteOne(${f.id})">🗑 Xóa</button></div>
        `;
        const chk = card.querySelector('.card-chk');
        chk.onclick = e => e.stopPropagation(); chk.onchange = () => { f.selected = chk.checked; renderFiles(); };
        card.querySelector('.card-body').onclick = e => { e.stopPropagation(); openPreview(f.id); };
        els.fileGrid.appendChild(card);
    });
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

window.openPreview = (id) => {
    const f = files.find(x=>x.id===id); if(!f) return; previewFileId = id;
    const list = getFilteredFiles(); const idx = list.findIndex(x=>x.id===id);
    els.previewTitle.innerText = f.name; document.querySelector('.modal-nav span').innerText = `${idx+1}/${list.length}`;
    els.previewDocHeader.innerText = f.headerInDoc;
    let content = "";
    if(f.segments) f.segments.forEach(seg => seg.lines.forEach(l => content += `<p>${l}</p>`));
    else content = f.rawContent.split('\n').map(l=>`<p>${l}</p>`).join('');
    els.previewBody.innerHTML = content; els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');
window.prevChapter = () => navChapter(-1);
window.nextChapter = () => navChapter(1);
function navChapter(d) { const l = getFilteredFiles(); const i = l.findIndex(x=>x.id===previewFileId); if(i!==-1 && l[i+d]) openPreview(l[i+d].id); else toast(d>0?"Hết":"Đầu"); }

window.downloadOne = (id) => { const f=files.find(x=>x.id===id); if(f&&f.blob) saveAs(f.blob, f.name); }
window.deleteOne = (id) => { if(confirm('Xóa?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderFiles(); } }
function deleteBatch() { const s = getFilteredFiles().filter(f=>f.selected); if(confirm(`Xóa ${s.length}?`)) { s.forEach(f=>delDB('files',f.id)); files=files.filter(f=>!f.selected || f.folderId!==currentFolderId); renderFiles(); } }
function downloadBatchZip() { const s = getFilteredFiles().filter(f=>f.selected); if(!s.length) return toast("Chưa chọn"); const z = new JSZip(); s.forEach(f=>z.file(f.name, f.blob)); z.generateAsync({type:"blob"}).then(c=>saveAs(c, `Batch_${Date.now()}.zip`)); }
async function downloadBatchDirect() { const s = getFilteredFiles().filter(f=>f.selected); if(!s.length) return toast("Chưa chọn"); toast(`Tải ${s.length} file...`); for(let i=0;i<s.length;i++) { if(s[i].blob) { saveAs(s[i].blob, s[i].name); await new Promise(r=>setTimeout(r,200)); } } }
function createFolder() { const n = prompt("Tên:"); if(n){const f={id:Date.now().toString(),name:n}; folders.push(f); saveDB('folders',f); currentFolderId=f.id; renderFolders(); renderFiles();} }
function deleteCurrentFolder() {
    if(currentFolderId==='root') return toast("Lỗi: Root");
    if(confirm("Xóa folder?")) {
        files.filter(f=>f.folderId===currentFolderId).forEach(f=>delDB('files',f.id));
        files = files.filter(f=>f.folderId!==currentFolderId);
        delDB('folders', currentFolderId); folders=folders.filter(f=>f.id!==currentFolderId);
        currentFolderId='root'; renderFolders(); renderFiles();
    }
}
function toast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

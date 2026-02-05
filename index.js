// CONFIG
const DB_NAME = 'WriterPortalV14';
const DB_VERSION = 1;
let db = null;
let files = [];
let folders = [];
let currentFolderId = 'root';
let readerFileId = null;

// --- HELPERS ---
function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}
function getChapterNum(title) {
    const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 0;
}

// --- DOM ELEMENTS ---
const els = {
    toggleSidebar: document.getElementById('toggleSidebar'),
    sidebar: document.querySelector('.sidebar'),
    folderSelect: document.getElementById('folderSelect'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDeleteFolder: document.getElementById('btnDeleteFolder'),
    fileList: document.getElementById('fileList'),
    fileCount: document.getElementById('fileCount'),
    selectAll: document.getElementById('selectAll'),
    btnDownloadBatch: document.getElementById('btnDownloadBatch'),
    btnDeleteBatch: document.getElementById('btnDeleteBatch'),
    
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'),
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    editor: document.getElementById('editor'),
    
    // Preview
    previewModal: document.getElementById('previewModal'),
    previewModalTitle: document.getElementById('previewModalTitle'),
    previewDocHeader: document.getElementById('previewDocHeader'),
    previewBody: document.getElementById('previewBody'),
    readerPageNum: document.getElementById('readerPageNum'),
    
    toast: document.getElementById('toast')
};

// --- DATABASE ---
function initDB() {
    return new Promise(resolve => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if(!d.objectStoreNames.contains('files')) d.createObjectStore('files', {keyPath: 'id'});
            if(!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', {keyPath: 'id'});
        };
        req.onsuccess = e => { db = e.target.result; loadData().then(resolve); };
    });
}
async function loadData() {
    files = await getAll('files');
    folders = await getAll('folders');
    if(!folders.find(f=>f.id==='root')) {
        folders.push({id:'root', name:'Truyện mặc định'});
        saveDB('folders', {id:'root', name:'Truyện mặc định'});
    }
    renderFolders();
    renderFiles();
}
function getAll(s) { return new Promise(r => db.transaction(s,'readonly').objectStore(s).getAll().onsuccess=e=>r(e.target.result||[])); }
function saveDB(s, i) { db.transaction(s,'readwrite').objectStore(s).put(i); }
function delDB(s, id) { db.transaction(s,'readwrite').objectStore(s).delete(id); }

// --- INIT APP ---
async function init() {
    await initDB();
    
    els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));
    
    // Folder Logic
    els.btnNewFolder.addEventListener('click', createFolder);
    els.btnDeleteFolder.addEventListener('click', deleteCurrentFolder);
    els.folderSelect.addEventListener('change', (e) => { currentFolderId = e.target.value; renderFiles(); });

    // File Actions
    els.selectAll.addEventListener('change', (e) => {
        const list = getSortedFiles();
        list.forEach(f => f.selected = e.target.checked);
        renderFiles();
    });
    els.btnDownloadBatch.addEventListener('click', downloadBatch);
    els.btnDeleteBatch.addEventListener('click', deleteBatch);

    // Merge Logic
    els.btnMerge.addEventListener('click', () => merge(true));
    els.btnClearOnly.addEventListener('click', () => { els.editor.value = ''; showToast('Đã làm mới khung soạn thảo'); });

    // Shortcuts
    document.addEventListener('keydown', e => {
        if(els.previewModal.classList.contains('show')) {
            if(e.key === 'ArrowLeft') prevChapter();
            if(e.key === 'ArrowRight') nextChapter();
            if(e.key === 'Escape') closePreview();
        }
    });
}

// --- FOLDERS ---
function renderFolders() {
    els.folderSelect.innerHTML = '';
    folders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.innerText = f.name;
        if(f.id === currentFolderId) opt.selected = true;
        els.folderSelect.appendChild(opt);
    });
}
function createFolder() {
    const name = prompt("Tên tập/quyển mới:");
    if(name) {
        const f = {id: Date.now().toString(), name: name};
        folders.push(f);
        saveDB('folders', f);
        currentFolderId = f.id;
        renderFolders(); renderFiles();
    }
}
function deleteCurrentFolder() {
    if(currentFolderId === 'root') return showToast("Không thể xóa thư mục gốc");
    if(confirm("Xóa thư mục và toàn bộ file bên trong?")) {
        const sub = files.filter(f=>f.folderId===currentFolderId);
        sub.forEach(f=>delDB('files', f.id));
        files = files.filter(f=>f.folderId!==currentFolderId);
        
        delDB('folders', currentFolderId);
        folders = folders.filter(f=>f.id!==currentFolderId);
        currentFolderId = 'root';
        renderFolders(); renderFiles();
    }
}

// --- MERGE LOGIC ---
async function merge(autoClear) {
    const content = els.editor.value;
    if(!content.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeName}.docx`;
    
    let segment = {
        idSort: getChapterNum(inputTitle) || 99999,
        text: content,
        header: inputTitle
    };

    if(els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if(match) fileName = `Chương ${match[1]}.docx`;
    }

    let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

    if(targetFile) {
        if(!targetFile.segments) targetFile.segments = [];
        targetFile.segments.push(segment);
        // SORTING: Quan trọng, xếp lại theo số chương
        targetFile.segments.sort((a,b) => a.idSort - b.idSort);
        
        // REBUILD CONTENT
        targetFile.rawContent = targetFile.segments.map(s => s.text).join('\n\n');
        // HEADER GỐC CỦA FILE (Vd: Chương 1)
        targetFile.headerInDoc = targetFile.name.replace('.docx','');
        targetFile.wordCount = countWords(targetFile.headerInDoc + " " + targetFile.rawContent);
        targetFile.timestamp = Date.now();
        
        targetFile.blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
        saveDB('files', targetFile);
        showToast(`Đã nối vào: ${fileName}`);
    } else {
        const wc = countWords(inputTitle + " " + content);
        targetFile = {
            id: Date.now(), name: fileName, folderId: currentFolderId,
            segments: [segment],
            rawContent: content,
            headerInDoc: inputTitle,
            wordCount: wc, timestamp: Date.now(), selected: false
        };
        targetFile.blob = await generateDocx(inputTitle, content);
        files.push(targetFile);
        saveDB('files', targetFile);
        showToast(`Tạo mới: ${fileName}`);
    }

    // Auto Increment
    const numMatch = inputTitle.match(/(\d+)(\.(\d+))?/);
    if(numMatch) {
        if(numMatch[2]) els.chapterTitle.value = inputTitle.replace(numMatch[0], `${numMatch[1]}.${parseInt(numMatch[3])+1}`);
        else els.chapterTitle.value = inputTitle.replace(numMatch[1], parseInt(numMatch[1])+1);
    }

    if(autoClear) els.editor.value = '';
    renderFiles();
}

function generateDocx(header, body) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const lines = body.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
    const children = [];
    
    // Header
    children.push(new Paragraph({
        children: [new TextRun({text: header, font: "Calibri", size: 32, color: "000000"})],
        spacing: {after: 240}
    }));
    // Dòng trắng
    children.push(new Paragraph({text: "", spacing: {after: 240}}));
    // Body
    lines.forEach(l => {
        children.push(new Paragraph({
            children: [new TextRun({text: l, font: "Calibri", size: 32, color: "000000"})],
            spacing: {after: 240}
        }));
    });
    return Packer.toBlob(new Document({sections:[{children}]}));
}

// --- RENDER & PREVIEW ---
function getSortedFiles() {
    const list = files.filter(f => f.folderId === currentFolderId);
    list.sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name));
    return list;
}

function renderFiles() {
    const list = getSortedFiles();
    els.fileCount.innerText = list.length;
    els.fileList.innerHTML = '';

    list.forEach(f => {
        const item = document.createElement('div');
        item.className = `chapter-item ${f.selected ? 'selected' : ''}`;
        item.onclick = (e) => { if(e.target.type!=='checkbox') openPreview(f.id); };
        
        item.innerHTML = `
            <input type="checkbox" class="chk-file" ${f.selected?'checked':''} onclick="event.stopPropagation(); toggleSelect(${f.id})">
            <div class="file-info">
                <div class="file-name">${f.name}</div>
                <div class="file-meta">
                    <span class="word-badge">${f.wordCount} words</span>
                    <button class="btn-text danger" onclick="event.stopPropagation(); deleteOne(${f.id})">Xóa</button>
                </div>
            </div>
        `;
        els.fileList.appendChild(item);
    });
}

// READER LOGIC
window.openPreview = (id) => {
    const f = files.find(x=>x.id===id);
    if(!f) return;
    readerFileId = id;
    
    const list = getSortedFiles();
    const idx = list.findIndex(x=>x.id===id);
    
    els.previewModalTitle.innerText = f.name;
    els.previewDocHeader.innerText = f.headerInDoc; // Header gốc của file
    els.previewBody.innerText = f.rawContent;
    els.readerPageNum.innerText = `Chương ${idx+1} / ${list.length}`;
    
    els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');
window.prevChapter = () => navChapter(-1);
window.nextChapter = () => navChapter(1);

function navChapter(dir) {
    const list = getSortedFiles();
    const idx = list.findIndex(x=>x.id===readerFileId);
    if(idx !== -1 && list[idx+dir]) openPreview(list[idx+dir].id);
    else showToast(dir>0 ? "Hết chương" : "Đầu chương");
}

// ACTIONS
window.toggleSelect = (id) => { const f=files.find(x=>x.id===id); if(f){f.selected=!f.selected; renderFiles();} };
window.deleteOne = (id) => { if(confirm('Xóa chương này?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderFiles(); } };
function downloadBatch() {
    const s = files.filter(f=>f.selected && f.folderId===currentFolderId);
    if(!s.length) return showToast('Chưa chọn file nào');
    const z = new JSZip();
    s.forEach(f => z.file(f.name, f.blob));
    z.generateAsync({type:"blob"}).then(c=>saveAs(c, `Truyen_${Date.now()}.zip`));
}
function deleteBatch() {
    const s = files.filter(f=>f.selected && f.folderId===currentFolderId);
    if(confirm(`Xóa ${s.length} file?`)) {
        s.forEach(f=>delDB('files',f.id));
        files = files.filter(f=>!f.selected || f.folderId!==currentFolderId);
        renderFiles();
    }
}
function showToast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

// CONFIG
const DB_NAME = 'AutoPilotV15';
const DB_VERSION = 1;
let db = null;
let files = [];
let folders = [];
let currentFolderId = 'root';

// --- HELPERS ---
function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}
function getChapterNum(title) {
    const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 0;
}

// --- DOM ---
const els = {
    folderSelect: document.getElementById('folderSelect'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDeleteFolder: document.getElementById('btnDeleteFolder'),
    fileGrid: document.getElementById('fileGrid'),
    fileCount: document.getElementById('fileCount'),
    selectAll: document.getElementById('selectAll'),
    
    btnDownloadBatch: document.getElementById('btnDownloadBatch'), // Zip
    btnDownloadDirect: document.getElementById('btnDownloadDirect'), // No Zip
    btnDeleteBatch: document.getElementById('btnDeleteBatch'),
    
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

// --- DB INIT ---
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
        folders.push({id:'root', name:'Thư mục chính'});
        saveDB('folders', {id:'root', name:'Thư mục chính'});
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
    
    els.btnNewFolder.onclick = createFolder;
    els.btnDeleteFolder.onclick = deleteCurrentFolder;
    els.folderSelect.onchange = (e) => { currentFolderId = e.target.value; renderFiles(); };

    els.selectAll.onchange = (e) => {
        const list = getSortedFiles();
        list.forEach(f => f.selected = e.target.checked);
        renderFiles();
    };
    
    els.btnDownloadBatch.onclick = downloadBatchZip;
    els.btnDownloadDirect.onclick = downloadBatchDirect; // Nút mới
    els.btnDeleteBatch.onclick = deleteBatch;

    // Nút ẩn (được trigger bởi Tampermonkey)
    els.btnMerge.onclick = () => merge(true);
}

// --- FOLDER ---
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
    const name = prompt("Tên thư mục mới:");
    if(name) {
        const f = {id: Date.now().toString(), name: name};
        folders.push(f);
        saveDB('folders', f);
        currentFolderId = f.id;
        renderFolders(); renderFiles();
    }
}
function deleteCurrentFolder() {
    if(currentFolderId === 'root') return toast("Không thể xóa Root");
    if(confirm("Xóa thư mục này?")) {
        const sub = files.filter(f=>f.folderId===currentFolderId);
        sub.forEach(f=>delDB('files',f.id));
        files = files.filter(f=>f.folderId!==currentFolderId);
        delDB('folders', currentFolderId);
        folders = folders.filter(f=>f.id!==currentFolderId);
        currentFolderId = 'root';
        renderFolders(); renderFiles();
    }
}

// --- MERGE LOGIC (AUTO PILOT) ---
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
        targetFile.segments.sort((a,b) => a.idSort - b.idSort);
        
        targetFile.rawContent = targetFile.segments.map(s => s.text).join('\n\n');
        targetFile.headerInDoc = targetFile.name.replace('.docx','');
        targetFile.wordCount = countWords(targetFile.headerInDoc + " " + targetFile.rawContent);
        targetFile.timestamp = Date.now();
        
        targetFile.blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
        saveDB('files', targetFile);
        toast(`Đã gộp vào: ${fileName}`);
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
        toast(`Đã lưu: ${fileName}`);
    }

    // Auto next
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
    children.push(new Paragraph({children: [new TextRun({text: header, font: "Calibri", size: 32, color: "000000"})], spacing: {after: 240}}));
    children.push(new Paragraph({text: "", spacing: {after: 240}}));
    lines.forEach(l => {
        children.push(new Paragraph({children: [new TextRun({text: l, font: "Calibri", size: 32, color: "000000"})], spacing: {after: 240}}));
    });
    return Packer.toBlob(new Document({sections:[{children}]}));
}

// --- RENDER ---
function getSortedFiles() {
    const list = files.filter(f => f.folderId === currentFolderId);
    list.sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name));
    return list;
}

function renderFiles() {
    const list = getSortedFiles();
    els.fileCount.innerText = list.length;
    els.fileGrid.innerHTML = '';

    list.forEach(f => {
        const card = document.createElement('div');
        card.className = `file-card ${f.selected ? 'selected' : ''}`;
        card.innerHTML = `
            <div class="card-header">
                <input type="checkbox" class="card-chk" ${f.selected?'checked':''}>
                <div class="card-icon">📄</div>
            </div>
            <div class="card-body" onclick="openPreview(${f.id})">
                <div class="file-name">${f.name}</div>
                <div class="file-info">
                    <span class="tag-wc">${f.wordCount} words</span>
                </div>
            </div>
            <div class="card-actions">
                <button class="btn-small" onclick="downloadOne(${f.id})">Tải Docx</button>
                <button class="btn-small del" onclick="deleteOne(${f.id})">Xóa</button>
            </div>
        `;
        const chk = card.querySelector('.card-chk');
        chk.onclick = (e) => e.stopPropagation();
        chk.onchange = () => { f.selected = chk.checked; renderFiles(); };
        els.fileGrid.appendChild(card);
    });
}

// --- ACTIONS ---
window.openPreview = (id) => {
    const f = files.find(x=>x.id===id);
    if(!f) return;
    els.previewTitle.innerText = f.name;
    els.previewDocHeader.innerText = f.headerInDoc;
    els.previewBody.innerText = f.rawContent;
    els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');

window.downloadOne = (id) => { const f=files.find(x=>x.id===id); if(f&&f.blob) saveAs(f.blob, f.name); }
window.deleteOne = (id) => { if(confirm('Xóa?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderFiles(); } }

function deleteBatch() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(confirm(`Xóa ${s.length} file?`)) {
        s.forEach(f=>delDB('files',f.id));
        files = files.filter(f=>!f.selected || f.folderId!==currentFolderId);
        renderFiles();
    }
}

function downloadBatchZip() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(!s.length) return toast("Chưa chọn file");
    const z = new JSZip();
    s.forEach(f => z.file(f.name, f.blob));
    z.generateAsync({type:"blob"}).then(c=>saveAs(c, `Batch_${Date.now()}.zip`));
}

// TẢI LẺ (DOWNLOAD DIRECT - NEW FEATURE)
async function downloadBatchDirect() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(!s.length) return toast("Chưa chọn file");
    
    toast(`Đang tải ${s.length} file...`);
    
    // Dùng vòng lặp với delay nhẹ để tránh trình duyệt chặn
    for (let i = 0; i < s.length; i++) {
        const f = s[i];
        if (f.blob) {
            saveAs(f.blob, f.name);
            // Chờ 300ms giữa mỗi file
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}

function toast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

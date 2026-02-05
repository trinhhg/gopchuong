const DB_NAME = 'WriterV13';
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
// Trích xuất số chương để sort (VD: "Chương 1.5" -> 1.5)
function getChapterNum(title) {
    const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 0;
}

// --- DOM ---
const els = {
    folderList: document.getElementById('folderList'),
    fileListSidebar: document.getElementById('fileListSidebar'),
    managerGrid: document.getElementById('managerGrid'),
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'),
    editor: document.getElementById('editor'),
    btnMerge: document.getElementById('btnMerge'),
    // Reader
    readerModal: document.getElementById('readerModal'),
    readerTitle: document.getElementById('readerTitle'),
    readerHeader: document.getElementById('readerHeader'),
    readerBody: document.getElementById('readerBody'),
    readerProgress: document.getElementById('readerProgress')
};

// --- DB & INIT ---
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
    renderAll();
}
function getAll(s) { return new Promise(r => db.transaction(s,'readonly').objectStore(s).getAll().onsuccess=e=>r(e.target.result||[])); }
function saveDB(s, i) { db.transaction(s,'readwrite').objectStore(s).put(i); }
function delDB(s, id) { db.transaction(s,'readwrite').objectStore(s).delete(id); }

async function init() {
    await initDB();
    document.getElementById('btnNewFolder').onclick = createFolder;
    document.getElementById('btnMerge').onclick = () => merge(true);
    document.getElementById('btnClearOnly').onclick = () => {els.editor.value=''; toast('Đã Reset');};
    document.getElementById('selectAllSidebar').onchange = (e) => {
        files.filter(f=>f.folderId===currentFolderId).forEach(f=>f.selected=e.target.checked);
        renderAll();
    };
    document.getElementById('btnDownloadBatch').onclick = downloadBatch;
    document.getElementById('btnDeleteBatch').onclick = deleteBatch;
    
    // Phím tắt Reader
    document.addEventListener('keydown', e => {
        if(document.getElementById('readerModal').classList.contains('show')) {
            if(e.key === 'ArrowLeft') prevChapter();
            if(e.key === 'ArrowRight') nextChapter();
            if(e.key === 'Escape') closeReader();
        }
    });
}

// --- CORE MERGE ---
async function merge(autoClear) {
    const content = els.editor.value;
    if(!content.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeName}.docx`;
    
    let segment = {
        idSort: getChapterNum(inputTitle) || 9999, 
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
        // Sắp xếp lại segment theo thứ tự chương (1.1, 1.2, 1.3...)
        targetFile.segments.sort((a,b) => a.idSort - b.idSort);
        
        // Tái tạo nội dung (Chỉ lấy nội dung, bỏ header 1.x)
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
            headerInDoc: inputTitle, // File mới thì lấy header gốc
            wordCount: wc, timestamp: Date.now(), selected: false
        };
        targetFile.blob = await generateDocx(inputTitle, content);
        files.push(targetFile);
        saveDB('files', targetFile);
        toast(`Mới: ${fileName}`);
    }

    // Auto Next Chapter Logic
    const numMatch = inputTitle.match(/(\d+)(\.(\d+))?/);
    if(numMatch) {
        if(numMatch[2]) els.chapterTitle.value = inputTitle.replace(numMatch[0], `${numMatch[1]}.${parseInt(numMatch[3])+1}`);
        else els.chapterTitle.value = inputTitle.replace(numMatch[1], parseInt(numMatch[1])+1);
    }

    if(autoClear) els.editor.value = '';
    renderAll();
}

function generateDocx(header, body) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const lines = body.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
    const children = [];
    
    children.push(new Paragraph({
        children: [new TextRun({text: header, font: "Calibri", size: 32, color: "000000"})],
        spacing: {after: 240}
    }));
    // Dòng trắng cách biệt
    children.push(new Paragraph({text: "", spacing: {after: 240}}));

    lines.forEach(l => {
        children.push(new Paragraph({
            children: [new TextRun({text: l, font: "Calibri", size: 32, color: "000000"})],
            spacing: {after: 240}
        }));
    });
    return Packer.toBlob(new Document({sections:[{children}]}));
}

// --- RENDER ---
function renderAll() {
    // FOLDERS
    els.folderList.innerHTML = '';
    folders.forEach(f => {
        const div = document.createElement('div');
        div.className = `folder-item ${f.id===currentFolderId?'active':''}`;
        div.innerText = f.name;
        div.onclick = () => { currentFolderId = f.id; renderAll(); };
        els.folderList.appendChild(div);
    });

    // FILES (Sorted by ID/Name logic)
    const list = files.filter(f => f.folderId === currentFolderId);
    list.sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name));
    
    document.getElementById('fileCount').innerText = list.length;
    els.fileListSidebar.innerHTML = '';
    els.managerGrid.innerHTML = '';

    list.forEach(f => {
        // Sidebar Row
        const row = document.createElement('div');
        row.className = `side-file ${f.selected?'selected':''}`;
        row.innerHTML = `<input type="checkbox" onclick="event.stopPropagation(); toggleSelect(${f.id})" ${f.selected?'checked':''}><span>${f.name}</span><span class="wc-badge">${f.wordCount}</span>`;
        row.onclick = (e) => { if(e.target.type!=='checkbox') openReader(f.id); };
        els.fileListSidebar.appendChild(row);

        // Grid Card
        const card = document.createElement('div');
        card.className = 'grid-card';
        card.innerHTML = `
            <input type="checkbox" class="chk-overlay" onclick="event.stopPropagation(); toggleSelect(${f.id})" ${f.selected?'checked':''}>
            <div class="icon">📄</div>
            <div class="title">${f.name}</div>
            <div class="meta"><span>${f.wordCount} words</span><span>DOCX</span></div>
        `;
        card.onclick = () => openReader(f.id);
        els.managerGrid.appendChild(card);
    });
}

// --- READER ---
window.openReader = (id) => {
    const f = files.find(x => x.id === id);
    if(!f) return;
    readerFileId = id;
    const list = files.filter(x => x.folderId === currentFolderId).sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name));
    const idx = list.findIndex(x => x.id === id);
    
    els.readerTitle.innerText = f.name;
    els.readerProgress.innerText = `${idx+1}/${list.length}`;
    
    // Hiển thị nội dung
    els.readerHeader.innerText = f.headerInDoc;
    els.readerBody.innerText = f.rawContent; // Raw content đã được join sạch sẽ
    
    document.getElementById('readerModal').classList.add('show');
}
window.closeReader = () => document.getElementById('readerModal').classList.remove('show');
window.nextChapter = () => navChapter(1);
window.prevChapter = () => navChapter(-1);

function navChapter(dir) {
    const list = files.filter(x => x.folderId === currentFolderId).sort((a,b) => getChapterNum(a.name) - getChapterNum(b.name));
    const idx = list.findIndex(x => x.id === readerFileId);
    if(idx !== -1 && list[idx+dir]) openReader(list[idx+dir].id);
    else toast(dir>0 ? "Hết chương" : "Đầu chương");
}

// --- UTILS ---
function createFolder() { const n=prompt("Tên:"); if(n){const f={id:Date.now().toString(),name:n}; folders.push(f); saveDB('folders',f); renderAll();} }
window.toggleSelect = (id) => { const f=files.find(x=>x.id===id); if(f){f.selected=!f.selected; renderAll();} };
function downloadBatch() { 
    const s = files.filter(f=>f.selected && f.folderId===currentFolderId);
    if(!s.length) return toast("Chưa chọn");
    const zip = new JSZip();
    s.forEach(f=>zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c=>saveAs(c, `Batch.zip`));
}
function deleteBatch() {
    const s = files.filter(f=>f.selected && f.folderId===currentFolderId);
    if(confirm(`Xóa ${s.length} file?`)) {
        s.forEach(f=>delDB('files',f.id));
        files = files.filter(f=>!f.selected || f.folderId!==currentFolderId);
        renderAll();
    }
}
function toast(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }

init();

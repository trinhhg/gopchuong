// --- DATABASE CONFIG ---
const DB_NAME = 'DocxToolDB';
const DB_VERSION = 1;
let db = null;

let files = []; 
let folders = [];
let currentFolderId = 'root';

// --- HÀM ĐẾM TỪ (CHUẨN MS WORD) ---
function countWords(text) {
    if (!text || text.trim() === '') return 0;
    // MS Word đếm từ dựa trên khoảng trắng (whitespace)
    // "Word-Word" là 1 từ. "Word, Word" là 2 từ.
    // Regex này tách theo khoảng trắng (space, tab, xuống dòng)
    return text.trim().split(/\s+/).length;
}

const els = {
    tabs: document.querySelectorAll('.tab-pill'),
    views: document.querySelectorAll('.view-content'),
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    editor: document.getElementById('editor'),
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'), 
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    folderNav: document.getElementById('folderNav'),
    fileCount: document.getElementById('fileCount'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),
    toast: document.getElementById('toast'),
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewDocHeader: document.getElementById('previewDocHeader'),
    previewBody: document.getElementById('previewBody')
};

// --- DB & INIT ---
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        };
        request.onsuccess = (e) => { db = e.target.result; loadFromDB().then(resolve); };
        request.onerror = () => reject('Lỗi DB');
    });
}
async function loadFromDB() {
    files = await getAllFromStore('files');
    folders = await getAllFromStore('folders');
    files.forEach(f => f.selected = false);
    renderAll();
}
function getAllFromStore(name) {
    return new Promise(r => { 
        const req = db.transaction(name, 'readonly').objectStore(name).getAll();
        req.onsuccess = () => r(req.result || []);
    });
}
function saveItemToDB(store, item) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(item); }
function deleteItemFromDB(store, id) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); }

async function init() {
    await initDB();
    els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));
    els.tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            els.tabs.forEach(t => t.classList.remove('active'));
            els.views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
    els.btnMerge.addEventListener('click', () => merge(true));
    els.btnClearOnly.addEventListener('click', () => { els.editor.value = ''; showToast('Đã xóa trắng'); });
    els.btnNewFolder.addEventListener('click', createFolder);
    const handleSelectAll = (checked) => {
        const visible = files.filter(f => f.folderId === currentFolderId);
        visible.forEach(f => f.selected = checked);
        renderAll();
    };
    els.selectAllSidebar.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    els.selectAllManager.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    els.btnDownloadAll.addEventListener('click', downloadBatch);
    els.btnDeleteSelected.addEventListener('click', deleteBatch);
}

// --- FOLDER & NAV ---
function createFolder() {
    const name = prompt("Tên thư mục mới:");
    if (name) {
        const f = { id: Date.now(), name: name };
        folders.push(f);
        saveItemToDB('folders', f);
        renderAll();
    }
}
window.enterFolder = (id) => { currentFolderId = id; renderAll(); }
window.navigateToFolder = (id) => { currentFolderId = id; renderAll(); }

// --- PREVIEW ---
window.openPreview = (id) => {
    const f = files.find(x => x.id === id);
    if (!f) return;
    els.previewTitle.innerText = f.name;
    els.previewDocHeader.innerText = f.headerInDoc;
    els.previewBody.innerText = f.rawContent;
    els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');

// --- MERGE (QUAN TRỌNG) ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return; // Không làm gì nếu rỗng

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    
    // 1. Chuẩn hóa tên file (thay : bằng -)
    let safeFileName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeFileName}.docx`;
    let headerTitle = inputTitle; 

    // 2. Logic Gộp (Nếu bật)
    if (els.autoGroup.checked) {
        // Regex tìm số chương. VD: "Chương 1.2" -> lấy số 1
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if (match) {
            fileName = `Chương ${match[1]}.docx`;
            // Khi gộp, tiêu đề Header của file gốc sẽ là "Chương 1" (chuẩn hóa)
            headerTitle = `Chương ${match[1]}`;
        }
    }

    try {
        let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

        if (targetFile) {
            // NỐI FILE
            targetFile.rawContent += "\n\n" + contentToAdd;
            targetFile.wordCount = countWords(targetFile.rawContent);
            targetFile.timestamp = Date.now();
            
            showToast(`📝 Đã nối: ${fileName} (${targetFile.wordCount} từ)`);
            const blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.blob = blob;
            saveItemToDB('files', targetFile);

        } else {
            // TẠO MỚI
            const wc = countWords(contentToAdd);
            targetFile = { 
                id: Date.now(), 
                name: fileName, 
                headerInDoc: headerTitle, 
                rawContent: contentToAdd, 
                wordCount: wc,
                blob: null, 
                selected: false,
                timestamp: Date.now(),
                folderId: currentFolderId
            };
            files.push(targetFile);
            
            showToast(`⚡ Mới: ${fileName} (${wc} từ)`);
            const blob = await generateDocx(headerTitle, contentToAdd);
            targetFile.blob = blob;
            saveItemToDB('files', targetFile);
        }

        // Tăng số chương (cho input lần sau)
        const numberMatch = inputTitle.match(/(\d+)(\.(\d+))?/);
        if (numberMatch) {
            if (numberMatch[2]) {
                const main = numberMatch[1];
                const sub = parseInt(numberMatch[3]) + 1;
                els.chapterTitle.value = inputTitle.replace(numberMatch[0], `${main}.${sub}`);
            } else {
                const main = parseInt(numberMatch[1]) + 1;
                els.chapterTitle.value = inputTitle.replace(numberMatch[1], main);
            }
        }

        // QUAN TRỌNG: Chỉ xóa Editor khi mọi thứ ĐÃ XONG
        // Đây là tín hiệu cho Tampermonkey biết "Tôi đã xong, hãy gửi cái tiếp theo"
        if(autoClear) els.editor.value = '';
        
        renderAll();

    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi xử lý');
    }
}

// --- GENERATE DOCX ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const paragraphsRaw = rawContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const docChildren = [];

    // Header
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: titleText, font: "Calibri", size: 32, color: "000000" })],
        spacing: { after: 240 }
    }));
    // Body
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: line, font: "Calibri", size: 32, color: "000000" })],
            spacing: { after: 240 }
        }));
    });
    return Packer.toBlob(new Document({ sections: [{ children: docChildren }] }));
}

// --- RENDER ---
function renderAll() {
    const currentFiles = files.filter(f => f.folderId === currentFolderId);
    currentFiles.sort((a, b) => b.timestamp - a.timestamp);

    els.fileCount.innerText = currentFiles.length;
    els.sidebarList.innerHTML = '';
    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = `file-item ${f.selected ? 'selected' : ''}`;
        div.innerHTML = `
            <input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})">
            <span class="name-link" onclick="openPreview(${f.id})" title="Xem trước">${f.name}</span>
            <span class="badge-wc">${f.wordCount}w</span>
        `;
        els.sidebarList.appendChild(div);
    });

    els.managerList.innerHTML = '';
    // Breadcrumb
    let navHtml = `<span class="nav-item ${currentFolderId === 'root' ? 'active' : ''}" onclick="navigateToFolder('root')">📁 Gốc</span>`;
    if (currentFolderId !== 'root') {
        const f = folders.find(x => x.id === currentFolderId);
        if (f) navHtml += ` <span class="sep">/</span> <span class="nav-item active">${f.name}</span>`;
    }
    els.folderNav.innerHTML = navHtml;

    // Folders
    if (currentFolderId === 'root') {
        folders.forEach(fo => {
            const div = document.createElement('div');
            div.className = 'file-row folder-row';
            div.innerHTML = `
                <div class="col-check"></div>
                <div class="col-name" onclick="enterFolder(${fo.id})">📁 ${fo.name}</div>
                <div class="col-action"><button class="mini-btn btn-del" onclick="deleteFolder(${fo.id})">✕</button></div>
            `;
            els.managerList.appendChild(div);
        });
    }
    // Files
    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-row';
        div.innerHTML = `
            <div class="col-check"><input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})"></div>
            <div class="col-name"><span class="name-link" onclick="openPreview(${f.id})">📄 ${f.name}</span></div>
            <div class="col-wc">${f.wordCount} từ</div>
            <div class="col-action action-btns">
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

// --- ACTIONS ---
window.toggleSelect = (id) => { const f = files.find(x => x.id === id); if(f){ f.selected = !f.selected; renderAll(); }};
window.downloadOne = (id) => { const f = files.find(x => x.id === id); if(f && f.blob) saveAs(f.blob, f.name); };
window.deleteOne = (id) => { if(confirm('Xóa?')) { deleteItemFromDB('files', id); files = files.filter(f => f.id !== id); renderAll(); } };
window.deleteFolder = (id) => {
    if(confirm('Xóa thư mục và toàn bộ file trong đó?')) {
        deleteItemFromDB('folders', id);
        const subFiles = files.filter(f => f.folderId === id);
        subFiles.forEach(f => deleteItemFromDB('files', f.id));
        folders = folders.filter(f => f.id !== id);
        files = files.filter(f => f.folderId !== id);
        renderAll();
    }
};
function downloadBatch() {
    const selected = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(!selected.length) return showToast('⚠️ Chưa chọn');
    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Batch_${Date.now()}.zip`));
}
function deleteBatch() {
    const selected = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(confirm(`Xóa ${selected.length} file?`)) {
        selected.forEach(f => deleteItemFromDB('files', f.id));
        files = files.filter(f => !f.selected || f.folderId !== currentFolderId);
        renderAll();
        els.selectAllSidebar.checked = false;
        els.selectAllManager.checked = false;
    }
}
function showToast(msg) { els.toast.innerText = msg; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 2000); }

init();

// --- DATABASE CONFIG (INDEXED DB) ---
const DB_NAME = 'DocxToolDB';
const DB_VERSION = 1;
let db = null;

// --- STATE ---
let files = []; 
let folders = [];
let currentFolderId = 'root'; // Thư mục hiện tại

// --- DOM ELEMENTS ---
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

// --- INIT DATABASE ---
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('files')) {
                db.createObjectStore('files', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('folders')) {
                db.createObjectStore('folders', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            loadFromDB().then(resolve);
        };
        request.onerror = (event) => reject('Lỗi DB');
    });
}

async function loadFromDB() {
    // Load Files
    files = await getAllFromStore('files');
    // Load Folders
    folders = await getAllFromStore('folders');
    // Reset selected state
    files.forEach(f => f.selected = false);
    renderAll();
}

// --- HELPER DB ---
function getAllFromStore(storeName) {
    return new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

function saveFileToDB(file) {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(file);
}

function deleteFileFromDB(id) {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(id);
}

function saveFolderToDB(folder) {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(folder);
}

function deleteFolderFromDB(id) {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').delete(id);
}

// --- LOGIC ĐẾM TỪ (CHUẨN WORD) ---
function countWords(text) {
    if (!text) return 0;
    // Regex này bao gồm cả chữ cái có dấu tiếng Việt và số, loại bỏ ký tự đặc biệt
    // Nó sát với MS Word nhất (Word đếm "abc," là 1 từ, "abc" là 1 từ)
    const matches = text.trim().match(/[\p{L}\p{N}\-]+/gu);
    return matches ? matches.length : 0;
}

// --- INIT APP ---
async function init() {
    await initDB(); // Đợi DB load xong mới chạy tiếp

    els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));
    
    // Tab switching
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

    // Select All
    const handleSelectAll = (checked) => {
        const visibleFiles = files.filter(f => f.folderId === currentFolderId);
        visibleFiles.forEach(f => f.selected = checked);
        renderAll();
    };
    els.selectAllSidebar.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    els.selectAllManager.addEventListener('change', (e) => handleSelectAll(e.target.checked));
    
    els.btnDownloadAll.addEventListener('click', downloadBatch);
    els.btnDeleteSelected.addEventListener('click', deleteBatch);
}

// --- PREVIEW LOGIC (FIXED) ---
window.openPreview = function(id) {
    const f = files.find(x => x.id === id);
    if (!f) return;
    
    els.previewTitle.innerText = f.name;
    // Hiển thị Header y hệt như trong file Word sẽ tải về
    els.previewDocHeader.innerText = f.headerInDoc; 
    els.previewBody.innerText = f.rawContent;
    
    els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');

// --- FOLDER LOGIC ---
function createFolder() {
    const name = prompt("Nhập tên thư mục mới:");
    if (name) {
        const folder = { id: Date.now(), name: name };
        folders.push(folder);
        saveFolderToDB(folder);
        renderAll();
    }
}

window.navigateToFolder = function(id) {
    currentFolderId = id;
    renderAll();
}

window.enterFolder = function(id) {
    currentFolderId = id;
    renderAll();
}

// --- MERGE LOGIC (CORE) ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return; 

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    
    // 1. Chuẩn hóa tên file và tiêu đề
    // Thay thế ký tự cấm filename
    let safeFileName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeFileName}.docx`;
    let headerTitle = inputTitle; // Header mặc định là input

    // 2. Logic Gộp (Nếu bật checkbox)
    if (els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if (match) {
            // Tên file gốc: "Chương 1.docx"
            fileName = `Chương ${match[1]}.docx`;
            // Header cho file gốc: "Chương 1" (Bỏ .1 đi để không bị dính)
            headerTitle = `Chương ${match[1]}`;
        }
    }

    try {
        // Tìm file trong Folder hiện tại
        let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

        if (targetFile) {
            // === NỐI VÀO FILE CŨ ===
            // Nối nội dung
            targetFile.rawContent += "\n\n" + contentToAdd;
            targetFile.wordCount = countWords(targetFile.rawContent);
            targetFile.timestamp = Date.now();
            
            showToast(`📝 Đã nối: ${fileName} (${targetFile.wordCount} từ)`);
            
            // Re-generate Blob
            // Lưu ý: targetFile.headerInDoc giữ nguyên là Header gốc (ví dụ "Chương 1")
            const blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.blob = blob;
            
            // Cập nhật DB
            saveFileToDB(targetFile);

        } else {
            // === TẠO FILE MỚI ===
            const wc = countWords(contentToAdd);
            targetFile = { 
                id: Date.now(), 
                name: fileName, 
                headerInDoc: headerTitle, // Lưu header chuẩn
                rawContent: contentToAdd, 
                wordCount: wc,
                blob: null, 
                selected: false,
                timestamp: Date.now(),
                folderId: currentFolderId // Lưu vào folder đang mở
            };
            files.push(targetFile);
            
            showToast(`⚡ Mới: ${fileName} (${wc} từ)`);
            
            const blob = await generateDocx(headerTitle, contentToAdd);
            targetFile.blob = blob;
            
            // Lưu DB
            saveFileToDB(targetFile);
        }

        // Tăng số chương tự động
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

        if(autoClear) els.editor.value = '';
        renderAll();

    } catch (e) {
        console.error(e);
        showToast('❌ Lỗi xử lý');
    }
}

// --- DOCX GENERATOR ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    
    const paragraphsRaw = rawContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const docChildren = [];

    // Header: Size 32 (16pt), Đen, Font Calibri, Không Bold
    docChildren.push(new Paragraph({
        children: [new TextRun({ 
            text: titleText, 
            font: "Calibri", 
            size: 32,
            color: "000000"
        })],
        spacing: { after: 240 }
    }));

    // Body
    paragraphsRaw.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ 
                text: line, 
                font: "Calibri", 
                size: 32,
                color: "000000"
            })],
            spacing: { after: 240 }
        }));
    });

    const doc = new Document({ sections: [{ children: docChildren }] });
    return Packer.toBlob(doc);
}

// --- RENDER UI ---
function renderAll() {
    // Filter items theo folder hiện tại
    const currentFiles = files.filter(f => f.folderId === currentFolderId);
    // Sort files mới nhất lên đầu
    currentFiles.sort((a, b) => b.timestamp - a.timestamp);

    // Sidebar
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

    // Manager
    els.managerList.innerHTML = '';
    
    // Breadcrumb Update
    updateBreadcrumb();

    // Render Folders (Chỉ hiện ở manager)
    if (currentFolderId === 'root') {
        folders.forEach(folder => {
            const div = document.createElement('div');
            div.className = 'file-row folder-row';
            div.innerHTML = `
                <div class="col-check"></div>
                <div class="col-name" onclick="enterFolder(${folder.id})">
                    📁 ${folder.name}
                </div>
                <div class="col-action">
                    <button class="mini-btn btn-del" onclick="deleteFolder(${folder.id})">✕</button>
                </div>
            `;
            els.managerList.appendChild(div);
        });
    }

    if (currentFiles.length === 0 && folders.length === 0 && currentFolderId === 'root') {
        els.managerList.innerHTML = '<div class="empty-text">Trống</div>';
    }

    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-row';
        div.innerHTML = `
            <div class="col-check"><input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})"></div>
            <div class="col-name">
                <span class="name-link" onclick="openPreview(${f.id})">📄 ${f.name}</span>
            </div>
            <div class="col-wc">${f.wordCount} từ</div>
            <div class="col-action action-btns">
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

function updateBreadcrumb() {
    let html = `<span class="nav-item ${currentFolderId === 'root' ? 'active' : ''}" onclick="navigateToFolder('root')">📁 Gốc</span>`;
    if (currentFolderId !== 'root') {
        const folder = folders.find(f => f.id === currentFolderId);
        if (folder) {
            html += ` <span class="sep">/</span> <span class="nav-item active">${folder.name}</span>`;
        }
    }
    els.folderNav.innerHTML = html;
}

// --- ACTIONS ---
window.toggleSelect = function(id) { 
    const f = files.find(x => x.id === id); 
    if(f) { f.selected = !f.selected; renderAll(); } 
}

window.downloadOne = function(id) { 
    const f = files.find(x => x.id === id); 
    if(f && f.blob) saveAs(f.blob, f.name); 
}

window.deleteOne = function(id) { 
    if(confirm('Xóa file này?')) { 
        files = files.filter(f => f.id !== id); 
        deleteFileFromDB(id);
        renderAll(); 
    } 
}

window.deleteFolder = function(id) {
    if(confirm('Xóa thư mục này? (Các file bên trong sẽ bị xóa)')) {
        // Xóa folder
        folders = folders.filter(f => f.id !== id);
        deleteFolderFromDB(id);
        
        // Xóa file trong folder đó
        const filesToDelete = files.filter(f => f.folderId === id);
        files = files.filter(f => f.folderId !== id);
        filesToDelete.forEach(f => deleteFileFromDB(f.id));
        
        renderAll();
    }
}

function downloadBatch() {
    const selected = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(!selected.length) return showToast('⚠️ Chưa chọn file');
    const zip = new JSZip();
    selected.forEach(f => zip.file(f.name, f.blob));
    zip.generateAsync({type:"blob"}).then(c => saveAs(c, `Download_${Date.now()}.zip`));
}

function deleteBatch() {
    const selected = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(confirm(`Xóa ${selected.length} file đã chọn?`)) {
        selected.forEach(f => deleteFileFromDB(f.id));
        files = files.filter(f => !f.selected || f.folderId !== currentFolderId);
        renderAll();
        els.selectAllSidebar.checked = false;
        els.selectAllManager.checked = false;
        showToast('Đã xóa xong');
    }
}

function showToast(msg) {
    els.toast.innerText = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// Start
init();

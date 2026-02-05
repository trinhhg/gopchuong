// --- CONFIG DATABASE ---
const DB_NAME = 'DocxToolDB';
const DB_VERSION = 1;
let db = null;
let files = []; 
let folders = [];
let currentFolderId = 'root';

// --- HÀM ĐẾM TỪ (CHUẨN WORD - Dựa theo thuật toán bạn đã test ok) ---
function countWords(text) {
    if (!text || text.trim() === '') return 0;
    // Tách theo khoảng trắng để đếm giống MS Word nhất
    return text.trim().split(/\s+/).length;
}

const els = {
    toggleSidebar: document.getElementById('toggleSidebar'),
    sidebar: document.getElementById('sidebar'),
    tabs: document.querySelectorAll('.tab-pill'),
    views: document.querySelectorAll('.view-content'),
    editor: document.getElementById('editor'),
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'),
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),
    fileCount: document.getElementById('fileCount'),
    sidebarList: document.getElementById('sidebarList'),
    managerList: document.getElementById('managerList'),
    folderNav: document.getElementById('folderNav'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    selectAllManager: document.getElementById('selectAllManager'),
    toast: document.getElementById('toast'),
    // Modal
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewDocHeader: document.getElementById('previewDocHeader'),
    previewBody: document.getElementById('previewBody')
};

// --- INIT ---
function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        };
        req.onsuccess = (e) => { db = e.target.result; loadFromDB().then(resolve); };
        req.onerror = () => reject('Lỗi DB');
    });
}
async function loadFromDB() {
    files = await getAll('files');
    folders = await getAll('folders');
    files.forEach(f => f.selected = false);
    renderAll();
}
function getAll(store) { return new Promise(r => { const req = db.transaction(store, 'readonly').objectStore(store).getAll(); req.onsuccess = () => r(req.result || []); }); }
function saveDB(store, item) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(item); }
function delDB(store, id) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); }

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

// --- PREVIEW LOGIC (FIXED) ---
// Gán vào window để HTML gọi được
window.openPreview = function(id) {
    const f = files.find(x => x.id === id);
    if (!f) return;
    
    els.previewTitle.innerText = f.name;
    els.previewDocHeader.innerText = f.headerInDoc; 
    els.previewBody.innerText = f.rawContent;
    
    els.previewModal.classList.add('show'); // Thêm class show để hiện Modal
}

window.closePreview = function() {
    els.previewModal.classList.remove('show'); // Bỏ class show để ẩn
}

// --- MERGE LOGIC ---
async function merge(autoClear) {
    const contentToAdd = els.editor.value;
    if (!contentToAdd.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    let safeFileName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeFileName}.docx`;
    let headerTitle = inputTitle;

    if (els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if (match) {
            fileName = `Chương ${match[1]}.docx`;
            headerTitle = `Chương ${match[1]}`;
        }
    }

    try {
        let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

        if (targetFile) {
            // Nối cũ
            targetFile.rawContent += "\n\n" + contentToAdd;
            targetFile.wordCount = countWords(targetFile.rawContent);
            targetFile.timestamp = Date.now();
            
            showToast(`📝 Đã nối: ${fileName} (${targetFile.wordCount} từ)`);
            const blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.blob = blob;
            saveDB('files', targetFile);
        } else {
            // Tạo mới
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
            saveDB('files', targetFile);
        }

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

    } catch (e) { console.error(e); }
}

// --- DOCX ---
function generateDocx(titleText, rawContent) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const paragraphsRaw = rawContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const docChildren = [];

    // Title
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
        div.onclick = (e) => { if(e.target.type!=='checkbox') openPreview(f.id); }; // Click dòng là mở preview
        div.innerHTML = `
            <input type="checkbox" ${f.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${f.id})">
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${f.name}</span>
            <span class="badge-wc">${f.wordCount}w</span>
        `;
        els.sidebarList.appendChild(div);
    });

    els.managerList.innerHTML = '';
    
    // Breadcrumb
    let navHtml = `<span class="nav-item ${currentFolderId==='root'?'active':''}" onclick="navigateToFolder('root')">📁 Gốc</span>`;
    if(currentFolderId!=='root'){
        const fo = folders.find(x=>x.id===currentFolderId);
        if(fo) navHtml += ` <span class="sep">/</span> <span class="nav-item active">${fo.name}</span>`;
    }
    els.folderNav.innerHTML = navHtml;

    if(currentFolderId==='root'){
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

    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-row';
        div.innerHTML = `
            <div class="col-check"><input type="checkbox" ${f.selected ? 'checked' : ''} onchange="toggleSelect(${f.id})"></div>
            <div class="col-name" onclick="openPreview(${f.id})">${f.name}</div>
            <div class="col-wc">${f.wordCount} từ</div>
            <div class="col-action">
                <button class="mini-btn btn-dl" onclick="downloadOne(${f.id})">⬇</button>
                <button class="mini-btn btn-del" onclick="deleteOne(${f.id})">✕</button>
            </div>
        `;
        els.managerList.appendChild(div);
    });
}

// --- ACTIONS ---
function createFolder() { const n = prompt("Tên thư mục:"); if(n) { const f={id:Date.now(), name:n}; folders.push(f); saveDB('folders', f); renderAll(); } }
window.enterFolder = (id) => { currentFolderId = id; renderAll(); }
window.navigateToFolder = (id) => { currentFolderId = id; renderAll(); }
window.toggleSelect = (id) => { const f=files.find(x=>x.id===id); if(f){f.selected=!f.selected; renderAll();} }
window.downloadOne = (id) => { const f=files.find(x=>x.id===id); if(f&&f.blob) saveAs(f.blob, f.name); }
window.deleteOne = (id) => { if(confirm('Xóa?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderAll(); } }
window.deleteFolder = (id) => { if(confirm('Xóa folder?')) { delDB('folders', id); folders=folders.filter(f=>f.id!==id); const subs=files.filter(f=>f.folderId===id); subs.forEach(f=>delDB('files', f.id)); files=files.filter(f=>f.folderId!==id); renderAll(); } }
function downloadBatch() { const s=files.filter(f=>f.selected && f.folderId===currentFolderId); if(!s.length) return showToast('Chưa chọn file'); const z=new JSZip(); s.forEach(f=>z.file(f.name, f.blob)); z.generateAsync({type:"blob"}).then(c=>saveAs(c, `Batch_${Date.now()}.zip`)); }
function deleteBatch() { const s=files.filter(f=>f.selected && f.folderId===currentFolderId); if(confirm(`Xóa ${s.length} file?`)) { s.forEach(f=>delDB('files', f.id)); files=files.filter(f=>!f.selected || f.folderId!==currentFolderId); renderAll(); els.selectAllSidebar.checked=false; els.selectAllManager.checked=false; } }
function showToast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

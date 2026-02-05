const DB_NAME = 'WriterStudioV11';
const DB_VERSION = 1;
let db = null;
let files = [];
let folders = [];
let currentFolderId = 'root';

// --- HELPERS ---
function countWords(text) {
    if (!text || text.trim() === '') return 0;
    return text.trim().split(/\s+/).length;
}

// Hàm trích xuất số từ tên chương để sort (VD: 1.1 -> 1.1, 2 -> 2)
function getChapterNumber(title) {
    const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i);
    return match ? parseFloat(match[1]) : 0;
}

// --- DOM ---
const els = {
    toggleSidebar: document.getElementById('toggleSidebar'),
    sidebar: document.getElementById('sidebar'),
    tabs: document.querySelectorAll('.tab-btn'),
    panels: document.querySelectorAll('.view-panel'),
    editor: document.getElementById('editor'),
    chapterTitle: document.getElementById('chapterTitle'),
    autoGroup: document.getElementById('autoGroup'),
    btnMerge: document.getElementById('btnMerge'),
    btnClearOnly: document.getElementById('btnClearOnly'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDownloadAll: document.getElementById('btnDownloadAll'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),
    folderList: document.getElementById('folderList'),
    sidebarFileList: document.getElementById('sidebarFileList'),
    managerGrid: document.getElementById('managerGrid'),
    fileCount: document.getElementById('fileCount'),
    breadcrumb: document.getElementById('breadcrumb'),
    selectAllSidebar: document.getElementById('selectAllSidebar'),
    toast: document.getElementById('toast'),
    // Reader
    readerModal: document.getElementById('readerModal'),
    readerTitle: document.getElementById('readerTitle'),
    readerHeader: document.getElementById('readerHeader'),
    readerBody: document.getElementById('readerBody'),
    currentChapterNum: document.getElementById('currentChapterNum')
};

// --- DB ---
function initDB() {
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if(!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        };
        req.onsuccess = (e) => { db = e.target.result; loadData().then(resolve); };
    });
}
async function loadData() {
    files = await getAll('files');
    folders = await getAll('folders');
    // Mặc định thư mục root nếu chưa có
    if(!folders.find(f => f.id === 'root')) {
        folders.push({id: 'root', name: 'Thư mục gốc'});
    }
    renderAll();
}
function getAll(store) { return new Promise(r => { const req = db.transaction(store, 'readonly').objectStore(store).getAll(); req.onsuccess = () => r(req.result||[]); }); }
function saveDB(store, item) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(item); }
function delDB(store, id) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); }

// --- INIT ---
async function init() {
    await initDB();
    
    els.toggleSidebar.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));
    
    // Tabs
    els.tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            els.tabs.forEach(b => b.classList.remove('active'));
            els.panels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
        });
    });

    els.btnMerge.addEventListener('click', () => merge(true));
    els.btnClearOnly.addEventListener('click', () => { els.editor.value = ''; showToast('Đã làm sạch'); });
    els.btnNewFolder.addEventListener('click', createFolder);
    
    els.selectAllSidebar.addEventListener('change', (e) => {
        const currentFiles = files.filter(f => f.folderId === currentFolderId);
        currentFiles.forEach(f => f.selected = e.target.checked);
        renderAll();
    });

    els.btnDownloadAll.addEventListener('click', downloadBatch);
    els.btnDeleteSelected.addEventListener('click', deleteBatch);

    // Keyboard navigation for Reader
    document.addEventListener('keydown', (e) => {
        if(els.readerModal.classList.contains('show')) {
            if(e.key === 'ArrowLeft') prevChapter();
            if(e.key === 'ArrowRight') nextChapter();
            if(e.key === 'Escape') closeReader();
        }
    });
}

// --- LOGIC FOLDERS ---
function createFolder() {
    const name = prompt("Tên thư mục mới:");
    if(name) {
        const folder = { id: Date.now().toString(), name: name };
        folders.push(folder);
        saveDB('folders', folder);
        renderAll();
    }
}
window.switchFolder = (id) => { currentFolderId = id; renderAll(); }
window.renameFolder = (id) => {
    const f = folders.find(x => x.id === id);
    const newName = prompt("Đổi tên thư mục:", f.name);
    if(newName) { f.name = newName; saveDB('folders', f); renderAll(); }
}
window.deleteFolder = (id) => {
    if(confirm('Xóa thư mục và toàn bộ file bên trong?')) {
        delDB('folders', id);
        folders = folders.filter(f => f.id !== id);
        // Delete files inside
        const subFiles = files.filter(f => f.folderId === id);
        subFiles.forEach(f => delDB('files', f.id));
        files = files.filter(f => f.folderId !== id);
        // Về root nếu đang ở folder bị xóa
        if(currentFolderId === id) currentFolderId = 'root';
        renderAll();
    }
}

// --- MERGE LOGIC (SORTING FIX) ---
async function merge(autoClear) {
    const content = els.editor.value;
    if(!content.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeName}.docx`;
    
    // Object chứa segment (mảnh chương) để sort
    // idSort là số chương (1.1, 1.2, 2...)
    let segment = {
        idSort: getChapterNumber(inputTitle) || 999999, 
        text: content,
        header: inputTitle
    };

    // Logic gộp
    if(els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if(match) {
            fileName = `Chương ${match[1]}.docx`;
        }
    }

    try {
        let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

        if(targetFile) {
            // Đã có file -> Thêm segment mới vào mảng segments
            if(!targetFile.segments) targetFile.segments = []; // Backward compatible
            
            // Thêm vào
            targetFile.segments.push(segment);
            
            // SORT LẠI SEGMENTS THEO SỐ CHƯƠNG (Tăng dần)
            targetFile.segments.sort((a, b) => a.idSort - b.idSort);

            // Tái tạo nội dung hiển thị (nối các mảnh lại)
            targetFile.rawContent = targetFile.segments.map(s => s.text).join('\n\n');
            targetFile.wordCount = countWords(targetFile.rawContent);
            targetFile.timestamp = Date.now();
            
            // Re-generate DOCX
            targetFile.blob = await generateDocxFromSegments(targetFile.segments);
            
            saveDB('files', targetFile);
            showToast(`Gộp & Sắp xếp: ${fileName}`);

        } else {
            // File mới
            const wc = countWords(content);
            targetFile = {
                id: Date.now(),
                name: fileName,
                folderId: currentFolderId,
                segments: [segment], // Lưu mảng segments ngay từ đầu
                rawContent: content,
                wordCount: wc,
                timestamp: Date.now(),
                selected: false
            };
            
            targetFile.blob = await generateDocxFromSegments(targetFile.segments);
            files.push(targetFile);
            saveDB('files', targetFile);
            showToast(`Tạo mới: ${fileName}`);
        }

        // Tăng số chương input
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

    } catch(e) { console.error(e); }
}

// --- DOCX GENERATOR (FIX SPACING) ---
function generateDocxFromSegments(segments) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const docChildren = [];

    segments.forEach(seg => {
        // 1. Tiêu đề chương
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: seg.header, font: "Calibri", size: 32, color: "000000" })],
            spacing: { before: 400, after: 240 } // Cách trên dưới chuẩn
        }));

        // 2. Dòng trắng bắt buộc (Empty Paragraph)
        docChildren.push(new Paragraph({ text: "" })); 

        // 3. Nội dung
        const lines = seg.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        lines.forEach(line => {
            docChildren.push(new Paragraph({
                children: [new TextRun({ text: line, font: "Calibri", size: 32, color: "000000" })],
                spacing: { after: 240 }
            }));
        });
        
        // Ngắt trang nếu cần (option) - ở đây dùng khoảng cách lớn
        docChildren.push(new Paragraph({ text: "", spacing: { after: 400 } }));
    });

    return Packer.toBlob(new Document({ sections: [{ children: docChildren }] }));
}

// --- READER PREVIEW LOGIC ---
let readerFileId = null;

window.openReader = (id) => {
    const f = files.find(x => x.id === id);
    if(!f) return;
    readerFileId = id;
    
    // Tìm index để hiện số trang
    const currentFiles = getSortedFiles();
    const idx = currentFiles.findIndex(x => x.id === id);
    
    els.readerTitle.innerText = f.name;
    els.currentChapterNum.innerText = `${idx + 1} / ${currentFiles.length}`;

    // Render nội dung reader (lấy từ segments nếu có, hoặc raw)
    if(f.segments && f.segments.length > 0) {
        // Nếu file gộp nhiều chương, hiển thị đẹp
        let html = '';
        f.segments.forEach(seg => {
            html += `<div style="margin-bottom: 50px;">
                        <h2 style="text-align:center; margin-bottom: 30px; font-weight:bold;">${seg.header}</h2>
                        <div>${seg.text.replace(/\n/g, '<br><br>')}</div>
                     </div>`;
        });
        els.readerHeader.style.display = 'none'; // Ẩn header chung
        els.readerBody.innerHTML = html;
    } else {
        // File cũ hoặc đơn lẻ
        els.readerHeader.style.display = 'block';
        els.readerHeader.innerText = f.name.replace('.docx', '');
        els.readerBody.innerText = f.rawContent;
    }

    els.readerModal.classList.add('show');
}
window.closeReader = () => els.readerModal.classList.remove('show');

window.nextChapter = () => {
    const sorted = getSortedFiles();
    const idx = sorted.findIndex(x => x.id === readerFileId);
    if(idx !== -1 && idx < sorted.length - 1) {
        openReader(sorted[idx + 1].id);
    } else {
        showToast("Đã là chương cuối");
    }
}

window.prevChapter = () => {
    const sorted = getSortedFiles();
    const idx = sorted.findIndex(x => x.id === readerFileId);
    if(idx > 0) {
        openReader(sorted[idx - 1].id);
    } else {
        showToast("Đã là chương đầu");
    }
}

function getSortedFiles() {
    const list = files.filter(f => f.folderId === currentFolderId);
    // Sort theo tên file (hoặc số chương trong tên file) để chuyển chương đúng logic
    list.sort((a, b) => getChapterNumber(a.name) - getChapterNumber(b.name));
    return list;
}


// --- RENDER UI ---
function renderAll() {
    // 1. Folders
    els.folderList.innerHTML = '';
    // Luôn hiện root trước
    const rootF = folders.find(f => f.id === 'root') || {id:'root', name:'Gốc'};
    folders.forEach(f => {
        const div = document.createElement('div');
        div.className = `folder-item ${f.id === currentFolderId ? 'active' : ''}`;
        div.innerHTML = `
            <span onclick="switchFolder('${f.id}')">📁 ${f.name}</span>
            <div class="folder-actions">
                ${f.id !== 'root' ? `<button class="btn-folder-act" onclick="renameFolder('${f.id}')">✎</button>
                                     <button class="btn-folder-act" onclick="deleteFolder('${f.id}')">✕</button>` : ''}
            </div>
        `;
        els.folderList.appendChild(div);
    });

    // Update Breadcrumb
    const currFolder = folders.find(f => f.id === currentFolderId);
    els.breadcrumb.innerText = `📂 ${currFolder ? currFolder.name : 'Gốc'}`;

    // 2. Files
    const currentFiles = getSortedFiles(); // Sort theo số chương
    els.fileCount.innerText = currentFiles.length;
    
    // Sidebar List
    els.sidebarFileList.innerHTML = '';
    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = `side-file ${f.selected ? 'selected' : ''}`;
        div.onclick = (e) => { if(e.target.type !== 'checkbox') openReader(f.id); };
        div.innerHTML = `
            <input type="checkbox" ${f.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${f.id})">
            <span>${f.name}</span>
            <span class="wc-tag">${f.wordCount}w</span>
        `;
        els.sidebarFileList.appendChild(div);
    });

    // Manager Grid
    els.managerGrid.innerHTML = '';
    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'grid-item';
        div.onclick = () => openReader(f.id);
        div.innerHTML = `
            <div class="check-overlay"><input type="checkbox" ${f.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${f.id})"></div>
            <div class="icon">📄</div>
            <div class="name">${f.name}</div>
            <div class="meta">
                <span>${f.wordCount} từ</span>
                <span>DOCX</span>
            </div>
        `;
        els.managerGrid.appendChild(div);
    });
}

// Actions
window.toggleSelect = (id) => { const f=files.find(x=>x.id===id); if(f){f.selected=!f.selected; renderAll();} }
function downloadBatch() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(!s.length) return showToast('Chưa chọn file');
    const z = new JSZip();
    s.forEach(f => z.file(f.name, f.blob));
    z.generateAsync({type:"blob"}).then(c => saveAs(c, `Download_${Date.now()}.zip`));
}
function deleteBatch() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(confirm(`Xóa ${s.length} file?`)) {
        s.forEach(f => delDB('files', f.id));
        files = files.filter(f => !f.selected || f.folderId !== currentFolderId);
        renderAll();
    }
}
function showToast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 2000); }

init();

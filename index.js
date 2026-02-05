// CONFIG
const DB_NAME = 'WriterCoreV12';
const DB_VERSION = 1;
let db = null;
let files = [];
let folders = [];
let currentFolderId = 'root';

// --- HÀM ĐẾM TỪ (CHUẨN WORD: HEADER + BODY) ---
function countWordsFull(header, body) {
    const fullText = (header + " " + body).trim();
    if (!fullText) return 0;
    return fullText.split(/\s+/).length;
}

const els = {
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
    liveHeader: document.getElementById('liveHeader'),
    
    previewModal: document.getElementById('previewModal'),
    previewModalTitle: document.getElementById('previewModalTitle'),
    previewDocHeader: document.getElementById('previewDocHeader'),
    previewBody: document.getElementById('previewBody'),
    
    toast: document.getElementById('toast')
};

// --- DB INIT ---
function initDB() {
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if(!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(); };
    });
}
async function loadData() {
    files = await getAll('files');
    folders = await getAll('folders');
    if(!folders.find(f => f.id === 'root')) {
        folders.push({id: 'root', name: 'Thư mục chính'});
        await saveDB('folders', {id: 'root', name: 'Thư mục chính'});
    }
    renderFolders();
    renderFiles();
}
function getAll(store) { return new Promise(r => { const req = db.transaction(store, 'readonly').objectStore(store).getAll(); req.onsuccess = () => r(req.result||[]); }); }
function saveDB(store, item) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(item); }
function delDB(store, id) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); }

// --- APP INIT ---
async function init() {
    await initDB();
    await loadData();

    // Folder Events
    els.btnNewFolder.addEventListener('click', createFolder);
    els.btnDeleteFolder.addEventListener('click', deleteCurrentFolder);
    els.folderSelect.addEventListener('change', (e) => { currentFolderId = e.target.value; renderFiles(); });

    // File Events
    els.selectAll.addEventListener('change', (e) => {
        const list = files.filter(f => f.folderId === currentFolderId);
        list.forEach(f => f.selected = e.target.checked);
        renderFiles();
    });
    els.btnDeleteBatch.addEventListener('click', deleteBatch);
    els.btnDownloadBatch.addEventListener('click', downloadBatch);

    // Editor Events
    els.chapterTitle.addEventListener('input', (e) => els.liveHeader.innerText = e.target.value || "Tiêu đề...");
    els.btnMerge.addEventListener('click', () => merge(true));
    els.btnClearOnly.addEventListener('click', () => { els.editor.value = ''; showToast("Đã làm sạch"); });
}

// --- FOLDER LOGIC ---
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
        const folder = { id: Date.now().toString(), name: name };
        folders.push(folder);
        saveDB('folders', folder);
        currentFolderId = folder.id;
        renderFolders();
        renderFiles();
    }
}
function deleteCurrentFolder() {
    if(currentFolderId === 'root') return showToast("Không thể xóa thư mục gốc");
    if(confirm("Xóa thư mục này và toàn bộ file bên trong?")) {
        const subFiles = files.filter(f => f.folderId === currentFolderId);
        subFiles.forEach(f => delDB('files', f.id));
        files = files.filter(f => f.folderId !== currentFolderId);
        delDB('folders', currentFolderId);
        folders = folders.filter(f => f.id !== currentFolderId);
        currentFolderId = 'root';
        renderFolders();
        renderFiles();
    }
}

// --- MERGE LOGIC (FIXED) ---
async function merge(autoClear) {
    const content = els.editor.value;
    if(!content.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    
    // 1. Chuẩn hóa tên file
    let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeName}.docx`;
    let headerTitle = inputTitle;

    // 2. Logic Gộp Thông Minh
    if(els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if(match) {
            fileName = `Chương ${match[1]}.docx`;
            // Khi gộp, Header của file sẽ là "Chương X" (Gốc)
            headerTitle = `Chương ${match[1]}`;
        }
    }

    try {
        let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

        if(targetFile) {
            // === NỐI VÀO ===
            // Ở đây ta chỉ nối nội dung (content), KHÔNG nối tiêu đề inputTitle (vd: Chương 1.2) vào nữa
            // Để tránh bị rác. Chỉ lấy nội dung thôi.
            targetFile.rawContent += "\n\n" + content;
            
            // Tính lại word count (Header + Body)
            targetFile.wordCount = countWordsFull(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.timestamp = Date.now();
            
            showToast(`Đã nối vào: ${fileName}`);
            const blob = await generateDocx(targetFile.headerInDoc, targetFile.rawContent);
            targetFile.blob = blob;
            saveDB('files', targetFile);

        } else {
            // === TẠO MỚI ===
            const wc = countWordsFull(headerTitle, content);
            targetFile = {
                id: Date.now(),
                name: fileName,
                headerInDoc: headerTitle,
                rawContent: content,
                wordCount: wc,
                folderId: currentFolderId,
                timestamp: Date.now(),
                selected: false
            };
            
            showToast(`Đã tạo: ${fileName}`);
            const blob = await generateDocx(headerTitle, content);
            targetFile.blob = blob;
            files.push(targetFile);
            saveDB('files', targetFile);
        }

        // Tăng số chương
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
        renderFiles();

    } catch(e) { console.error(e); }
}

// --- DOCX GENERATOR ---
function generateDocx(header, body) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const docChildren = [];

    // 1. Header
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: header, font: "Calibri", size: 32, color: "000000" })],
        spacing: { after: 0 } // Reset spacing
    }));

    // 2. Dòng trắng cách nội dung (Empty Paragraph)
    docChildren.push(new Paragraph({
        children: [], 
        spacing: { after: 240 } // Khoảng cách chuẩn
    }));

    // 3. Body
    lines.forEach(line => {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: line, font: "Calibri", size: 32, color: "000000" })],
            spacing: { after: 240 }
        }));
    });

    return Packer.toBlob(new Document({ sections: [{ children: docChildren }] }));
}

// --- RENDER FILES ---
function renderFiles() {
    const list = files.filter(f => f.folderId === currentFolderId);
    list.sort((a, b) => b.timestamp - a.timestamp);
    
    els.fileCount.innerText = list.length;
    els.fileList.innerHTML = '';

    list.forEach(f => {
        const card = document.createElement('div');
        card.className = `file-card ${f.selected ? 'selected' : ''}`;
        card.innerHTML = `
            <div class="card-top">
                <input type="checkbox" class="card-chk" ${f.selected ? 'checked' : ''}>
                <div class="card-name" onclick="openPreview(${f.id})">${f.name}</div>
            </div>
            <div class="card-meta">
                <span class="badge-wc">${f.wordCount} words</span>
                <div class="card-actions">
                    <button class="btn-mini" onclick="downloadOne(${f.id})">Tải DOCX</button>
                    <button class="btn-mini del" onclick="deleteOne(${f.id})">Xóa</button>
                </div>
            </div>
        `;
        // Event listener riêng để tránh conflict
        const chk = card.querySelector('.card-chk');
        chk.addEventListener('change', () => { f.selected = chk.checked; renderFiles(); });
        
        els.fileList.appendChild(card);
    });
}

// --- PREVIEW ---
window.openPreview = (id) => {
    const f = files.find(x => x.id === id);
    if(!f) return;
    els.previewModalTitle.innerText = f.name;
    els.previewDocHeader.innerText = f.headerInDoc;
    els.previewBody.innerText = f.rawContent;
    els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');

// --- ACTIONS ---
window.downloadOne = (id) => { const f=files.find(x=>x.id===id); if(f&&f.blob) saveAs(f.blob, f.name); }
window.deleteOne = (id) => { if(confirm('Xóa?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderFiles(); } }

function deleteBatch() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(confirm(`Xóa ${s.length} file?`)) {
        s.forEach(f => delDB('files', f.id));
        files = files.filter(f => !f.selected || f.folderId !== currentFolderId);
        renderFiles();
    }
}
function downloadBatch() {
    const s = files.filter(f => f.selected && f.folderId === currentFolderId);
    if(!s.length) return showToast('Chưa chọn file');
    const z = new JSZip();
    s.forEach(f => z.file(f.name, f.blob));
    z.generateAsync({type:"blob"}).then(c => saveAs(c, `Batch_${Date.now()}.zip`));
}
function showToast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

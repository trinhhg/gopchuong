// CONFIG
const DB_NAME = 'AutoPilotV18'; // Đổi tên DB để reset sạch sẽ dữ liệu cũ tránh lỗi
const DB_VERSION = 1;
let db = null;
let files = [];
let folders = [];
let currentFolderId = 'root';
let previewFileId = null;

// --- HELPERS ---
function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}

function getChapterNum(title) {
    // Regex lấy số chương chuẩn xác (1, 1.1, 1.2...)
    const match = title.match(/(?:Chương|Chapter|Hồi)\s*(\d+(\.\d+)?)/i);
    // Nếu không tìm thấy số, trả về timestamp để luôn nằm cuối
    return match ? parseFloat(match[1]) : Date.now();
}

function cleanContent(text) {
    return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

// --- DOM ---
const els = {
    folderSelect: document.getElementById('folderSelect'),
    btnNewFolder: document.getElementById('btnNewFolder'),
    btnDeleteFolder: document.getElementById('btnDeleteFolder'),
    fileGrid: document.getElementById('fileGrid'),
    fileCount: document.getElementById('fileCount'),
    selectAll: document.getElementById('selectAll'),
    searchInput: document.getElementById('searchInput'),
    
    btnDownloadBatch: document.getElementById('btnDownloadBatch'),
    btnDownloadDirect: document.getElementById('btnDownloadDirect'),
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
        const list = getFilteredFiles();
        list.forEach(f => f.selected = e.target.checked);
        renderFiles();
    };
    
    els.searchInput.oninput = renderFiles;

    els.btnDownloadBatch.onclick = downloadBatchZip;
    els.btnDownloadDirect.onclick = downloadBatchDirect;
    els.btnDeleteBatch.onclick = deleteBatch;

    els.btnMerge.onclick = () => merge(true);
    
    document.addEventListener('keydown', e => {
        if(els.previewModal.classList.contains('show')) {
            if(e.key === 'ArrowLeft') prevChapter();
            if(e.key === 'ArrowRight') nextChapter();
            if(e.key === 'Escape') closePreview();
        }
    });
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

// --- MERGE LOGIC (FIX DUPLICATE) ---
async function merge(autoClear) {
    const content = els.editor.value;
    if(!content.trim()) return;

    const inputTitle = els.chapterTitle.value.trim() || "Chương Mới";
    let safeName = inputTitle.replace(/[:*?"<>|]/g, " -").trim();
    let fileName = `${safeName}.docx`;
    
    const lines = cleanContent(content);
    if(lines.length === 0) return;

    // Xác định ID của Segment dựa trên số chương (ví dụ 8.3)
    // ID này dùng để định danh duy nhất cho đoạn text đó trong file
    const chapterNum = getChapterNum(inputTitle);
    
    let segment = {
        idSort: chapterNum,
        lines: lines,
        header: inputTitle
    };

    if(els.autoGroup.checked) {
        const match = inputTitle.match(/(?:Chương|Chapter|Hồi)\s*(\d+)/i);
        if(match) fileName = `Chương ${match[1]}.docx`;
    }

    let targetFile = files.find(f => f.name === fileName && f.folderId === currentFolderId);

    if(targetFile) {
        if(!targetFile.segments) targetFile.segments = [];
        
        // --- LOGIC CHỐNG TRÙNG (V18) ---
        // Tìm xem trong file đã có chương này chưa (dựa vào idSort)
        const existingIndex = targetFile.segments.findIndex(s => s.idSort === chapterNum);

        if (existingIndex !== -1) {
            // NẾU CÓ RỒI: Ghi đè (Update) nội dung mới vào vị trí cũ
            targetFile.segments[existingIndex] = segment;
            toast(`Đã cập nhật lại: ${inputTitle}`); // Thông báo khác đi chút
        } else {
            // NẾU CHƯA CÓ: Thêm mới vào
            targetFile.segments.push(segment);
            toast(`Đã nối thêm: ${inputTitle}`);
        }

        // Sắp xếp lại theo thứ tự chương
        targetFile.segments.sort((a,b) => a.idSort - b.idSort);
        
        // Tái tạo nội dung hiển thị
        let allText = "";
        targetFile.segments.forEach(seg => {
            allText += seg.lines.join('\n') + '\n';
        });

        targetFile.headerInDoc = targetFile.name.replace('.docx','');
        targetFile.wordCount = countWords(targetFile.headerInDoc + " " + allText);
        targetFile.timestamp = Date.now();
        
        targetFile.blob = await generateDocxFromSegments(targetFile.headerInDoc, targetFile.segments);
        saveDB('files', targetFile);
        
    } else {
        // TẠO FILE MỚI
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
        toast(`Đã tạo mới: ${fileName}`);
    }

    // Auto next logic
    const numMatch = inputTitle.match(/(\d+)(\.(\d+))?/);
    if(numMatch) {
        if(numMatch[2]) els.chapterTitle.value = inputTitle.replace(numMatch[0], `${numMatch[1]}.${parseInt(numMatch[3])+1}`);
        else els.chapterTitle.value = inputTitle.replace(numMatch[1], parseInt(numMatch[1])+1);
    }

    if(autoClear) els.editor.value = '';
    renderFiles();
}

function generateDocxFromSegments(mainHeader, segments) {
    const { Document, Packer, Paragraph, TextRun } = docx;
    const children = [];

    // Header File
    children.push(new Paragraph({
        children: [new TextRun({text: mainHeader, font: "Calibri", size: 32, color: "000000"})],
        spacing: {after: 240}
    }));
    // Dòng trắng sau header
    children.push(new Paragraph({text: "", spacing: {after: 240}}));

    // Nội dung các segments
    segments.forEach(seg => {
        // Có thể thêm tiêu đề chương con ở đây nếu muốn, hiện tại ta chỉ nối nội dung
        // Nếu muốn hiện "Chương 8.3" trong nội dung gộp thì uncomment dòng dưới:
        /*
        children.push(new Paragraph({
             children: [new TextRun({text: seg.header, font: "Calibri", size: 28, bold: true})],
             spacing: {before: 240, after: 120}
        }));
        */

        seg.lines.forEach(line => {
            children.push(new Paragraph({
                children: [new TextRun({text: line, font: "Calibri", size: 32, color: "000000"})],
                spacing: {after: 240} // Cách dòng 12pt
            }));
        });
    });

    return Packer.toBlob(new Document({sections:[{children}]}));
}

// --- RENDER & SORT ---
function getFilteredFiles() {
    let list = files.filter(f => f.folderId === currentFolderId);
    const keyword = document.getElementById('searchInput').value.toLowerCase().trim();
    if(keyword) {
        list = list.filter(f => f.name.toLowerCase().includes(keyword));
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
            f.selected = !f.selected;
            renderFiles();
        };

        card.innerHTML = `
            <div class="card-header">
                <input type="checkbox" class="card-chk" ${f.selected?'checked':''}>
                <div class="card-icon">📄</div>
            </div>
            <div class="card-body" title="Xem trước">
                <div class="file-name">${f.name}</div>
                <div class="file-info">
                    <span class="tag-wc">${f.wordCount} words</span>
                </div>
            </div>
            <div class="card-actions">
                <button class="btn-small view" onclick="event.stopPropagation(); openPreview(${f.id})">👁 Xem</button>
                <button class="btn-small del" onclick="event.stopPropagation(); deleteOne(${f.id})">🗑 Xóa</button>
            </div>
        `;
        
        const chk = card.querySelector('.card-chk');
        chk.onclick = (e) => e.stopPropagation();
        chk.onchange = () => { f.selected = chk.checked; renderFiles(); };
        
        const body = card.querySelector('.card-body');
        body.onclick = (e) => { e.stopPropagation(); openPreview(f.id); };

        els.fileGrid.appendChild(card);
    });
}

// --- ACTIONS & PREVIEW ---
window.openPreview = (id) => {
    const f = files.find(x=>x.id===id);
    if(!f) return;
    previewFileId = id;
    
    const list = getFilteredFiles();
    const idx = list.findIndex(x=>x.id===id);
    
    els.previewTitle.innerText = f.name;
    document.querySelector('.modal-nav span').innerText = `${idx + 1}/${list.length}`;
    els.previewDocHeader.innerText = f.headerInDoc;
    
    let content = "";
    if(f.segments) {
        f.segments.forEach(seg => {
            seg.lines.forEach(line => {
                content += `<p>${line}</p>`;
            });
        });
    } else {
        content = f.rawContent.split('\n').map(l=>`<p>${l}</p>`).join('');
    }
    
    els.previewBody.innerHTML = content;
    els.previewModal.classList.add('show');
}
window.closePreview = () => els.previewModal.classList.remove('show');
window.prevChapter = () => navChapter(-1);
window.nextChapter = () => navChapter(1);

function navChapter(dir) {
    const list = getFilteredFiles();
    const idx = list.findIndex(x=>x.id===previewFileId);
    if(idx !== -1 && list[idx+dir]) openPreview(list[idx+dir].id);
    else toast(dir>0 ? "Hết danh sách" : "Đầu danh sách");
}

window.deleteOne = (id) => { if(confirm('Xóa?')) { delDB('files', id); files=files.filter(f=>f.id!==id); renderFiles(); } }

function deleteBatch() {
    const s = getFilteredFiles().filter(f => f.selected);
    if(confirm(`Xóa ${s.length} file?`)) {
        s.forEach(f=>delDB('files',f.id));
        files = files.filter(f=>!f.selected || f.folderId!==currentFolderId);
        renderFiles();
    }
}

function downloadBatchZip() {
    const s = getFilteredFiles().filter(f => f.selected);
    if(!s.length) return toast("Chưa chọn file");
    const z = new JSZip();
    s.forEach(f => z.file(f.name, f.blob));
    z.generateAsync({type:"blob"}).then(c=>saveAs(c, `Batch_${Date.now()}.zip`));
}

async function downloadBatchDirect() {
    const s = getFilteredFiles().filter(f => f.selected);
    if(!s.length) return toast("Chưa chọn file");
    toast(`Đang tải ${s.length} file...`);
    for (let i = 0; i < s.length; i++) {
        const f = s[i];
        if (f.blob) {
            saveAs(f.blob, f.name);
            await new Promise(r => setTimeout(r, 200));
        }
    }
}

function toast(m) { els.toast.innerText = m; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'), 2000); }

init();

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Bot, Boxes, Check, CheckCircle2, ChevronDown, ChevronLeft, CircleHelp, Clock3, Code2, Copy, FileArchive, FolderGit2, GitBranch, KeyRound, LayoutDashboard, LoaderCircle, LogOut, MessageSquareText, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, TerminalSquare, Trash2, UploadCloud, Users, X, Zap } from "lucide-react";
import { COOKIE_NAME, startLogin } from "../const";
import { trpc } from "@/lib/trpc";

const timeAgo = (value?: Date | string | null) => {
  if (!value) return "لم يتصل بعد";
  const date = new Date(value).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
};

const shortDate = (value?: Date | string | null) => value ? new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" }).format(new Date(value)) : "—";
const statusLabels: Record<string, string> = { open: "مفتوحة", in_progress: "قيد التنفيذ", done: "مكتملة" };

function Mark({ small = false }: { small?: boolean }) {
  return <span className={`wasl-mark ${small ? "wasl-mark-small" : ""}`} aria-hidden="true"><svg viewBox="0 0 42 42" fill="none"><path d="M10 11.5 20.8 21 32 11.5M20.8 21 11 31M20.8 21 32 31" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="10" cy="11.5" r="4.2" fill="currentColor"/><circle cx="32" cy="11.5" r="4.2" fill="currentColor"/><circle cx="20.8" cy="21" r="4.2" fill="currentColor"/><circle cx="11" cy="31" r="4.2" fill="currentColor"/><circle cx="32" cy="31" r="4.2" fill="currentColor"/></svg></span>;
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-head"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18}/></button></div>{children}
  </section></div>;
}

function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{body}</p>{action}</div>;
}

export default function Home() {
  const auth = trpc.auth.me.useQuery();
  const user = auth.data;
  const [section, setSection] = useState("overview");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [repoModal, setRepoModal] = useState(false);
  const [deleteRepoModal, setDeleteRepoModal] = useState(false);
  const [keyModal, setKeyModal] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDescription, setNewRepoDescription] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [keyScope, setKeyScope] = useState<"full" | "github_upload" | "repository_edit" | "repository_upload">("full");
  const [keyRepositoryId, setKeyRepositoryId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [freshCredential, setFreshCredential] = useState<{ token: string; prompt: string; scope: "full" | "github_upload" | "repository_edit" | "repository_upload"; scopedRepositoryId?: string | null; repositoryName?: string | null } | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const repos = trpc.workspace.repositories.list.useQuery(undefined, { enabled: !!user });
  const allActivity = trpc.workspace.activity.list.useQuery({}, { enabled: !!user });
  const keys = trpc.workspace.agents.listKeys.useQuery(undefined, { enabled: !!user });
  const activeRepo = repos.data?.find(repo => repo.id === selectedRepoId) ?? null;
  const tasks = trpc.workspace.tasks.list.useQuery({ repositoryId: activeRepo?.id ?? "" }, { enabled: !!activeRepo });
  const versions = trpc.workspace.repositories.versions.useQuery({ id: activeRepo?.id ?? "" }, { enabled: !!activeRepo });

  useEffect(() => {
    if (!selectedRepoId && repos.data?.length) setSelectedRepoId(repos.data[0].id);
    if (selectedRepoId && repos.data?.length && !repos.data.some(repo => repo.id === selectedRepoId)) setSelectedRepoId(repos.data[0]?.id ?? null);
  }, [repos.data, selectedRepoId]);

  const createRepo = trpc.workspace.repositories.create.useMutation({
    onSuccess: async repo => { await utils.workspace.repositories.list.invalidate(); setSelectedRepoId(repo.id); setSection("repositories"); setRepoModal(false); setNewRepoName(""); setNewRepoDescription(""); toast.success("تم إنشاء المستودع"); },
    onError: error => toast.error(error.message),
  });
  const createKey = trpc.workspace.agents.createKey.useMutation({
    onSuccess: async result => {
      const origin = window.location.origin;
      const prompt = result.scope === "github_upload"
        ? `أنت وكيل تطوير متصل بمنصة وصل وبحساب GitHub مصرح به في بيئتك. استخدم مفتاح وصل المحدود لتنزيل المشروع المطلوب، ثم ارفعه بنفسك إلى GitHub عبر اتصال GitHub الموجود في بيئتك. لا تطلب كلمة مرور أو Personal Access Token، ولا ترسل أسرار GitHub إلى وصل.

عنوان API: ${origin}/api/github-upload/v1
رمز Bearer لوصل: ${result.token}

صلاحيات هذا المفتاح محدودة: عرض مشاريع المالك، تنزيل ZIP لمشروع نشط، وتسجيل نتيجة النشر. لا يسمح بتعديل مشاريع وصل أو إنشائها أو إدارة مهامها.

الخطوات:
1. إذا لم يحدد المستخدم المشروع، اعرض GET /repositories واختر المشروع المطلوب؛ راجع الاسم والوصف وhasArchive. أرسل Authorization: Bearer ${result.token} مع كل طلب API لوصل. إذا كان hasArchive=false، أخبر المالك أنه يحتاج رفع ZIP أولًا من واجهة وصل أو بمفتاح وصل الكامل؛ مفتاح التصدير لا يرفع ملفات إلى وصل.
2. اطلب GET /repositories/{repositoryId}/archive، ثم نزّل ZIP من downloadUrl المعاد. رابط التنزيل مؤقت ولا يحتاج إلى إعادة إرسال مفتاح وصل إليه.
3. إذا حدّد المستخدم مستودع GitHub قائمًا، استخدم حسابك المتصل به، وحافظ على التاريخ والفرع والملفات غير المرتبطة بالمشروع. أضف أو حدّث ملفات المشروع المطلوبة وادفع commit عاديًا؛ لا تستخدم force push ولا تحذف محتوى خارج نطاق الطلب. إذا لم يحدد وجهة، أنشئ مستودع GitHub جديدًا خاصًا باسم مناسب؛ لا تجعله عامًا إلا إذا طلب المستخدم ذلك صراحة.
4. إذا لم يكن حساب GitHub متصلًا بأدواتك أو لم يملك صلاحية الوجهة، أوقف النشر وأخبر المستخدم بضرورة ربط GitHub أو منح الوكيل صلاحية. لا تطلب منه إرسال بيانات اعتماد.
5. بعد نجاح الرفع، أرسل POST /repositories/{repositoryId}/publish-result مع JSON يحتوي الحقول githubUrl وbranch وcommitSha. استخدم رابطًا بالشكل https://github.com/owner/repo وSHA الحقيقي للـcommit. يسجل وصل الرابط والفرع والـSHA في سجل المشروع.

لا تضع مفتاح وصل أو أي سر في ملفات GitHub أو commit أو سجل النشاط. أخبر المستخدم بالنتيجة ورابط GitHub والفرع والـcommit.`
        : result.scope === "repository_upload"
        ? `أنت وكيل تطوير متصل بمنصة وصل. هذا مفتاح رفع محدود ينشئ مشروعًا واحدًا عند أول رفع ثم يبقى مرتبطًا به. لا تعرض المفتاح في السجلات أو المحادثات.

عنوان API: ${origin}/api/repository-upload/v1
رمز Bearer: ${result.token}

ابدأ بـ GET /repository لمعرفة هل رُبط المفتاح بمستودع سابقًا. إذا أعاد bound=false، أنشئ ZIP صالحًا للمشروع ثم أرسل POST /repository/archive مع Content-Type: application/zip وX-Repository-Name (مطلوب لأول رفع) وX-Repository-Description (اختياري). شفّر قيمة كل عنوان بـ encodeURIComponent كي تدعم أسماء ووصف العربية. الحد الأقصى 25 ميغابايت.

أول رفع صالح ينشئ مستودع وصل خاصًا ويربط المفتاح به على الخادم قبل حفظ النسخة. إذا فشل حفظ الملف بعد الربط، أعد GET /repository ثم أعد رفع ZIP إلى المسار نفسه دون اسم مشروع جديد؛ لن ينشأ مستودع ثانٍ. لا ترسل أي repositoryId ولا تحاول اختيار مشروع آخر.

الواجهات المسموحة فقط:
- GET /repository — حالة الربط وبيانات المشروع الوحيد؛ تكون repository=null قبل أول رفع.
- POST /repository/archive — إنشاء المشروع عند أول رفع أو حفظ نسخة ZIP جديدة للمشروع المرتبط.
- GET /repository/archive — رابط تنزيل مؤقت لأحدث ZIP بعد إنشاء نسخة.

لا توجد واجهات لقائمة المشاريع أو إنشاء مشروع آخر أو تعديل بيانات المشروع أو إدارة المهام أو الأرشفة أو استعادة النسخ. إذا كان المشروع مؤرشفًا، أوقف العملية وأخبر المالك؛ لا تحاول تجاوز القيد أو إنشاء بديل. لا ترفع المشروع إلى GitHub بهذا المفتاح؛ استخدم اتصال GitHub الخاص بك عند طلب المستخدم وبمفتاح تصدير GitHub المناسب. لا تطلب أسرارًا من المالك.

أرسل Authorization: Bearer ${result.token} مع كل طلب. بعد الرفع أخبر المستخدم باسم المستودع ورقم النسخة وحالة النجاح.`
        : result.scope === "repository_edit"
        ? `أنت وكيل تطوير تعمل على مستودع واحد في وصل. حافظ على سرية المفتاح ولا تعرضه في السجلات أو المحادثات.

المستودع المسموح فقط: ${result.repositoryName} (المعرّف ${result.scopedRepositoryId}).
عنوان API: ${origin}/api/repository-agent/v1
رمز Bearer: ${result.token}

هذا المفتاح مربوط بهذا المستودع من جهة الخادم؛ لا تحاول اختيار أو الوصول إلى مستودع آخر. ابدأ بـ GET /repository وGET /repository/activities وGET /repository/tasks لفهم السياق. إذا لم توجد نسخة، اطلب من المالك رفع ZIP أولًا.

واجهات هذا المفتاح:
- GET /repository — بيانات المستودع المحدد.
- PATCH /repository — تحديث الاسم أو الوصف فقط.
- GET /repository/archive ثم تنزيل downloadUrl — تنزيل ZIP الحالي.
- POST /repository/archive — رفع ZIP جديد كنسخة للمستودع المحدد فقط (Content-Type: application/zip وX-Archive-Name؛ الحد 25 ميغابايت).
- GET /repository/versions وPOST /repository/versions/{versionId}/restore — عرض نسخ هذا المستودع واستعادة نسخة.
- GET /repository/tasks وPOST /repository/tasks وPATCH /repository/tasks/{taskId} — إدارة مهامه.
- GET /repository/activities وPOST /repository/messages — متابعة النشاط وإرسال رسائل تقدم.

أرسل Authorization: Bearer ${result.token} مع كل طلب. لا يوجد مسار لإنشاء أو أرشفة مستودعات، ولا يقبل هذا API معرّف مستودع يرسله العميل؛ جميع العمليات مقيدة بالخادم إلى المستودع المحدد. لا تطلب أو تكشف أسرارًا. بعد التعديل ارفع ZIP جديدًا، حدّث حالة المهام وأرسل ملخصًا بالرسائل. `
        : `أنت وكيل إدارة عامة متصل بمنصة وصل. يتيح لك هذا المفتاح عرض جميع مستودعات مالك الحساب النشطة وفتح تفاصيل كل مشروع وإدارة مستودعات وصل بالكامل: الإنشاء والقراءة والتعديل والأرشفة ورفع وتنزيل ZIP وإدارة المهام والرسائل واستعادة النسخ. لا يمنحك صلاحية GitHub. حافظ على سرية المفتاح ولا تعرضه في السجلات أو المحادثات.

عنوان API: ${origin}/api/agents/v1
رمز Bearer: ${result.token}

ابدأ بـGET /repositories لاستعراض جميع مشاريع الحساب، ثم استخدم GET /repositories/{id} لفتح المشروع وقراءة تفاصيله ونسخه ومهامه ونشاطه. إذا كان المشروع المطلوب موجودًا فاعمل على معرّفه، وإذا لم يكن موجودًا فأنشئ مستودعًا باسم واضح ثم ارفع حزمة ZIP للمشروع. عند تعديل مشروع قائم، نزّل الأرشيف الحالي من GET /repositories/{id}/archive (ثم نزّله من downloadUrl)، عدّل الملفات في بيئتك، وأنشئ ZIP جديدًا وارفعه إلى POST /repositories/{id}/archive مع Content-Type: application/zip وX-Archive-Name. كل رفع يصبح نسخة جديدة.

واجهات العمل:
- GET /repositories — قائمة مستودعات الحساب.
- POST /repositories — إنشاء مستودع جديد؛ أرسل JSON يحتوي name وdescription.
- GET /repositories/{id} — بيانات المشروع والنسخ والمهام والنشاط.
- PATCH /repositories/{id} — تعديل الاسم أو الوصف.
- GET /repositories/{id}/archive — رابط تنزيل مؤقت للنسخة الحالية.
- POST /repositories/{id}/archive — رفع مشروع ZIP أو تحديث مشروع قائم.
- GET /repositories/{id}/versions — سجل النسخ.
- POST /repositories/{id}/versions/{versionId}/restore — استعادة نسخة.
- GET /repositories/{id}/tasks وPOST /repositories/{id}/tasks — قراءة/إنشاء مهمة.
- PATCH /repositories/{id}/tasks/{taskId} — تحديث الحالة إلى open أو in_progress أو done وتعيين الوكيل.
- GET /repositories/{id}/activities — متابعة سجل المشروع المشترك.
- POST /repositories/{id}/messages — رسالة تقدم مرتبطة بالمشروع أو المهمة.
- DELETE /repositories/{id} — أرشفة المستودع (حذف منطقي).

أرسل Authorization: Bearer ${result.token} مع كل طلب. اقرأ سجل النشاط كي لا تكرر عمل وكيل آخر، وسجّل تقدمك عبر الرسائل والمهام. الحد الأعلى للأرشيف 25 ميغابايت. استخدم أسماء ملفات آمنة وتأكد من أن ZIP صالح.`;
      setFreshCredential({ token: result.token, prompt, scope: result.scope, scopedRepositoryId: result.scopedRepositoryId, repositoryName: result.repositoryName }); setKeyModal(false); setKeyLabel("");
      await utils.workspace.agents.listKeys.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const revokeKey = trpc.workspace.agents.revokeKey.useMutation({ onSuccess: () => { void utils.workspace.agents.listKeys.invalidate(); toast.success("تم إلغاء المفتاح"); }, onError: error => toast.error(error.message) });
  const archiveRepository = trpc.workspace.repositories.archive.useMutation({
    onSuccess: async () => {
      setDeleteRepoModal(false);
      await Promise.all([utils.workspace.repositories.list.invalidate(), utils.workspace.repositories.versions.invalidate(), utils.workspace.tasks.list.invalidate(), utils.workspace.activity.list.invalidate(), utils.workspace.agents.listKeys.invalidate()]);
      setSelectedRepoId(null);
      setSection("repositories");
      toast.success("أُزيل المستودع من القائمة النشطة ونُقل إلى الأرشيف");
    },
    onError: error => toast.error(error.message),
  });
  const createTask = trpc.workspace.tasks.create.useMutation({ onSuccess: async () => { await Promise.all([utils.workspace.tasks.list.invalidate(), utils.workspace.activity.list.invalidate()]); setTaskModal(false); setTaskTitle(""); setTaskDescription(""); toast.success("أُضيفت المهمة إلى لوحة المشروع"); }, onError: error => toast.error(error.message) });
  const updateTask = trpc.workspace.tasks.update.useMutation({ onSuccess: async () => { await Promise.all([utils.workspace.tasks.list.invalidate(), utils.workspace.activity.list.invalidate()]); }, onError: error => toast.error(error.message) });
  const restore = trpc.workspace.repositories.restore.useMutation({ onSuccess: async () => { await Promise.all([utils.workspace.repositories.versions.invalidate(), utils.workspace.activity.list.invalidate(), utils.workspace.repositories.list.invalidate()]); toast.success("تمت استعادة النسخة؛ أُنشئت نسخة جديدة"); }, onError: error => toast.error(error.message) });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => window.location.reload() });
  const download = async (versionId?: string) => {
    if (!activeRepo) return;
    try {
      const file = await utils.workspace.repositories.download.fetch({ id: activeRepo.id, versionId });
      window.open(file.url, "_blank", "noopener,noreferrer");
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر تنزيل المشروع"); }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>, repoId: string) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) { toast.error("ارفع ملفًا بامتداد ZIP"); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error("الحد الأعلى لحجم المشروع 25 ميغابايت"); return; }
    setUploadingId(repoId);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/zip", "X-Archive-Name": encodeURIComponent(file.name) };
      try {
        const raw = sessionStorage.getItem("manus-cookie");
        const prefix = `${COOKIE_NAME}=`;
        const pair = raw?.split(";").find(part => part.trim().startsWith(prefix));
        const token = pair?.trim().slice(prefix.length);
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch { /* regular OAuth cookies remain the primary path */ }
      const response = await fetch(`/api/repositories/${repoId}/archive`, {
        method: "POST", credentials: "include", headers, body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر رفع الملف");
      await Promise.all([utils.workspace.repositories.list.invalidate(), utils.workspace.repositories.versions.invalidate(), utils.workspace.activity.list.invalidate()]);
      toast.success(`رُفعت نسخة ${result.version.versionNumber} بنجاح`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر رفع المشروع"); }
    finally { setUploadingId(null); }
  };

  const filteredRepos = useMemo(() => (repos.data ?? []).filter(repo => `${repo.name} ${repo.description ?? ""}`.toLowerCase().includes(searchTerm.toLowerCase())), [repos.data, searchTerm]);
  const openTasksCount = (tasks.data ?? []).filter(task => task.status !== "done").length;
  const connectedKeys = (keys.data ?? []).filter(key => !key.revokedAt && !key.scopedRepositoryArchivedAt);
  const nav = [
    { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
    { id: "repositories", label: "المستودعات", icon: FolderGit2, badge: repos.data?.length ?? 0 },
    { id: "tasks", label: "المهام", icon: CheckCircle2 },
    { id: "agents", label: "الوكلاء والربط", icon: Bot },
    { id: "activity", label: "سجل النشاط", icon: Activity },
  ];

  if (auth.isLoading) return <div className="loading-screen" dir="rtl"><span className="loading-orbit"><LoaderCircle size={24}/></span><p>نجهّز مساحة وصل…</p></div>;

  if (!user) return <main className="login-screen" dir="rtl"><div className="login-card"><Mark/><span className="eyebrow">مساحة تطوير تعاونية</span><h1>المشروع يجمعكم.<br/><em>والإنجاز يربطكم.</em></h1><p>ارفع مستودعاتك، جهّز مهامك، واربط وكلاء البرمجة بواجهة واحدة وسجل عمل مشترك.</p><button className="button button-primary button-large" onClick={() => startLogin()}>الدخول بحساب Manus <ArrowLeft size={17}/></button><div className="login-note"><ShieldCheck size={16}/> مشاريعك ومفاتيحك مرتبطة بحسابك</div></div><div className="login-side"><div className="login-network"><span/><span/><span/><span/><span/></div><p>ملفّات. مهام. وكلاء.<br/>مسار واحد.</p></div></main>;

  const openCreateRepo = () => { setNewRepoName(""); setNewRepoDescription(""); setRepoModal(true); };
  const onCreateRepository = (event: FormEvent) => { event.preventDefault(); if (newRepoName.trim()) createRepo.mutate({ name: newRepoName.trim(), description: newRepoDescription.trim() || null }); };
  const onCreateKey = (event: FormEvent) => { event.preventDefault(); if (!keyLabel.trim()) return; if (keyScope === "repository_edit" && !keyRepositoryId) { toast.error("اختر مستودعًا نشطًا لهذا المفتاح"); return; } createKey.mutate({ label: keyLabel.trim(), scope: keyScope, repositoryId: keyScope === "repository_edit" ? keyRepositoryId : undefined }); };
  const onCreateTask = (event: FormEvent) => { event.preventDefault(); if (activeRepo && taskTitle.trim()) createTask.mutate({ repositoryId: activeRepo.id, title: taskTitle.trim(), description: taskDescription.trim() || null }); };

  return <div className="wasl-app" dir="rtl">
    <aside className="sidebar">
      <div className="brand-lockup"><Mark/><span><strong>وصل</strong><small>مساحة تطوير جماعية</small></span></div>
      <div className="workspace-switch"><span className="workspace-avatar">{(user.name || "م").trim().slice(0, 1)}</span><span className="workspace-copy"><strong>{user.name || "مساحة عملي"}</strong><small>مساحة شخصية</small></span><ChevronDown size={15}/></div>
      <div className="side-caption">مساحة العمل</div>
      <nav className="main-nav" aria-label="التنقل الرئيسي">{nav.map(item => {
        const Icon = item.icon;
        return <button key={item.id} className={`nav-item ${section === item.id ? "nav-active" : ""}`} onClick={() => setSection(item.id)}><Icon size={18}/><span>{item.label}</span>{item.badge !== undefined && <span className="nav-count">{item.badge}</span>}</button>;
      })}</nav>
      <div className="side-caption side-caption-lower">نشاط الوكلاء</div>
      <div className="agent-peek"><span className={`status-dot ${connectedKeys.some(key => key.lastUsedAt && Date.now() - new Date(key.lastUsedAt).getTime() < 300000) ? "dot-live" : "dot-idle"}`}/><div><strong>{connectedKeys.length} مفاتيح نشطة</strong><small>آخر نشاط عبر API</small></div><ChevronLeft size={15}/></div>
      <div className="sidebar-spacer"/>
      <div className="sidebar-help"><span className="help-icon"><CircleHelp size={17}/></span><div><strong>تحتاج إلى مساعدة؟</strong><small>راجع دليل الوكلاء والربط</small></div><ChevronLeft size={14}/></div>
      <div className="profile-row"><span className="profile-avatar">{(user.name || user.email || "م").trim().slice(0, 1)}</span><div className="profile-info"><strong>{user.name || "حساب وصل"}</strong><small>{user.email || "عضو مساحة العمل"}</small></div><button className="icon-button profile-logout" title="تسجيل الخروج" onClick={() => void logout.mutate()}><LogOut size={16}/></button></div>
    </aside>

    <div className="work-area">
      <header className="topbar"><div className="crumb"><span>مساحة العمل</span><ChevronLeft size={14}/><strong>{nav.find(item => item.id === section)?.label ?? "المستودعات"}</strong></div><div className="topbar-actions"><label className="search-box"><Search size={16}/><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="ابحث عن مشروع…" aria-label="البحث عن مشروع"/><kbd>⌘ K</kbd></label><button className="button button-primary top-create" onClick={openCreateRepo}><Plus size={17}/> مشروع جديد</button></div></header>
      <main className="page-content">
        <div className="page-heading"><div><span className="eyebrow">مرحبًا بعودتك، {user.name?.split(" ")[0] || "مطور"}</span><h1>{section === "overview" ? "مساحة تطويرك" : nav.find(item => item.id === section)?.label}</h1><p>{section === "overview" ? "كل مشروع وفكرة ووكيل في مسار واحد واضح." : section === "agents" ? "اختر مفتاح الإدارة العامة لرؤية وفتح وإدارة جميع مشاريع الحساب، أو مفتاح تصدير GitHub، أو مفتاح تعديل مستودع واحد." : "تابع مشاريعك وتعاونك من مكان واحد."}</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => { void Promise.all([utils.workspace.repositories.list.invalidate(), utils.workspace.activity.list.invalidate(), utils.workspace.agents.listKeys.invalidate()]); }}><RefreshCw size={15}/> تحديث</button><button className="button button-primary" onClick={openCreateRepo}><Plus size={17}/> مشروع جديد</button></div></div>

        {repos.isLoading ? <div className="panel-loading"><LoaderCircle className="spin" size={22}/> جارٍ تحميل مساحة العمل…</div> : repos.error ? <div className="notice notice-error">تعذر تحميل المشاريع: {repos.error.message}<button onClick={() => void repos.refetch()}>إعادة المحاولة</button></div> : null}

        {section === "overview" && !repos.isLoading && <>
          <section className="stats-row">
            <div className="stat-card stat-primary"><div className="stat-top"><span className="stat-icon"><FolderGit2 size={18}/></span><span className="stat-kicker">مستودعاتك</span><span className="stat-mark">01</span></div><div className="stat-value">{repos.data?.length ?? 0}</div><div className="stat-foot"><span>مساحة خاصة لمشاريعك</span><GitBranch size={15}/></div></div>
            <div className="stat-card"><div className="stat-top"><span className="stat-icon stat-icon-mint"><Bot size={18}/></span><span className="stat-kicker">مفاتيح الوكلاء</span><span className="stat-mark">02</span></div><div className="stat-value">{connectedKeys.length}</div><div className="stat-foot"><span>صلاحيات حسب نوع المفتاح</span><Zap size={15}/></div></div>
            <div className="stat-card"><div className="stat-top"><span className="stat-icon stat-icon-amber"><CheckCircle2 size={18}/></span><span className="stat-kicker">مهام مفتوحة</span><span className="stat-mark">03</span></div><div className="stat-value">{openTasksCount}</div><div className="stat-foot"><span>{activeRepo ? `في ${activeRepo.name}` : "اختر مستودعًا لمتابعتها"}</span><Clock3 size={15}/></div></div>
          </section>
          <div className="dashboard-grid">
            <section className="surface project-surface"><div className="surface-heading"><div><span className="eyebrow">مساحة العمل</span><h2>المستودعات الأخيرة</h2></div><button className="text-button" onClick={() => setSection("repositories")}>عرض الكل <ArrowLeft size={15}/></button></div>
              {(repos.data ?? []).length ? <div className="repository-list">{(repos.data ?? []).slice(0, 4).map((repo, index) => <button className={`repo-row ${selectedRepoId === repo.id ? "repo-selected" : ""}`} key={repo.id} onClick={() => { setSelectedRepoId(repo.id); setSection("repositories"); }}><span className={`repo-glyph glyph-${index % 4}`}><Code2 size={19}/></span><span className="repo-main"><strong>{repo.name}</strong><small>{repo.description || "مستودع خاص · لا يوجد وصف"}</small></span><span className="repo-meta"><span className="privacy-pill"><span/> خاص</span><small>{shortDate(repo.updatedAt)}</small></span><MoreHorizontal size={17} className="row-more"/></button>)}</div> : <EmptyState icon={<FolderGit2 size={23}/>} title="ابدأ بمستودعك الأول" body="أنشئ مشروعًا أو ارفع حزمة ZIP، ثم اربط به وكلاءك." action={<button className="button button-primary" onClick={openCreateRepo}><Plus size={16}/> إنشاء مشروع</button>}/>}
            </section>
            <section className="surface agent-surface"><div className="surface-heading"><div><span className="eyebrow">تنسيق ذكي</span><h2>الوكلاء والربط</h2></div><span className="surface-icon"><Bot size={18}/></span></div><div className="agent-banner"><span className="agent-banner-orbit orbit-a"/><span className="agent-banner-orbit orbit-b"/><Mark small/><div><strong>فريقك جاهز للاتصال</strong><small>أربعة أنواع من المفاتيح لكل مهمة</small></div><span className="connection-chip"><i/> REST API</span></div><div className="agent-stats"><div><span>مفاتيح نشطة</span><strong>{connectedKeys.length.toString().padStart(2, "0")}</strong></div><div><span>آخر استخدام</span><strong>{timeAgo(connectedKeys.map(k => k.lastUsedAt).filter(Boolean).sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0])}</strong></div></div><button className="button button-dark button-block" onClick={() => setKeyModal(true)}><KeyRound size={16}/> اختيار نوع المفتاح وبرومبته</button></section>
          </div>
          <section className="surface activity-surface"><div className="surface-heading"><div><span className="eyebrow">آخر ما حدث</span><h2>سجل النشاط</h2></div><button className="text-button" onClick={() => setSection("activity")}>كل النشاط <ArrowLeft size={15}/></button></div><ActivityList items={(allActivity.data ?? []).slice(0, 5)} repositories={repos.data ?? []}/></section>
        </>}

        {section === "repositories" && !repos.isLoading && <div className="content-layout"><section className="surface main-panel"><div className="surface-heading"><div><span className="eyebrow">مستودعات الحساب</span><h2>مشاريعك <span className="heading-count">{filteredRepos.length}</span></h2></div><button className="button button-primary" onClick={openCreateRepo}><Plus size={16}/> مستودع جديد</button></div>
          {filteredRepos.length ? <div className="repository-list repository-list-full">{filteredRepos.map((repo, index) => <article className={`repo-row repo-row-card ${selectedRepoId === repo.id ? "repo-selected" : ""}`} key={repo.id} onClick={() => setSelectedRepoId(repo.id)}><span className={`repo-glyph glyph-${index % 4}`}><Code2 size={19}/></span><span className="repo-main"><strong>{repo.name}</strong><small>{repo.description || "مستودع خاص"}</small><span className="repo-subline"><span className="privacy-pill"><span/> خاص</span><span>آخر تحديث {shortDate(repo.updatedAt)}</span></span></span><div className="repo-card-actions"><button className="button button-small button-secondary" disabled={uploadingId === repo.id} onClick={e => { e.stopPropagation(); document.getElementById(`upload-row-${repo.id}`)?.click(); }}>{uploadingId === repo.id ? <LoaderCircle className="spin" size={15}/> : <UploadCloud size={15}/>} رفع ZIP</button><input id={`upload-row-${repo.id}`} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={e => void handleUpload(e, repo.id)}/><button className="icon-button" title="فتح تفاصيل المشروع" onClick={e => { e.stopPropagation(); setSelectedRepoId(repo.id); }}><ChevronLeft size={17}/></button></div></article>)}</div> : <EmptyState icon={<Archive size={23}/>} title="لا توجد مستودعات مطابقة" body={searchTerm ? "جرّب كلمة بحث أخرى أو أنشئ مستودعًا جديدًا." : "أنشئ مستودعك الأول لتبدأ التعاون مع الوكلاء."} action={<button className="button button-primary" onClick={openCreateRepo}><Plus size={16}/> إنشاء مستودع</button>}/>}</section>
          <aside className="surface detail-panel">{activeRepo ? <><div className="detail-title"><span className="repo-glyph glyph-1"><Code2 size={19}/></span><div><span className="eyebrow">مستودع خاص</span><h3>{activeRepo.name}</h3></div><span className="live-indicator"><i/> متصل</span></div><p className="detail-description">{activeRepo.description || "أضف وصفًا قصيرًا لمساعدة الوكلاء على فهم هدف المشروع."}</p><div className="detail-actions"><button className="button button-primary button-block" disabled={uploadingId === activeRepo.id} onClick={() => document.getElementById(`upload-${activeRepo.id}`)?.click()}>{uploadingId === activeRepo.id ? <LoaderCircle className="spin" size={15}/> : <UploadCloud size={16}/>} رفع نسخة مشروع</button><button className="button button-secondary button-block" onClick={() => void download()}><ArrowDownToLine size={16}/> تنزيل أحدث نسخة</button><button className="button button-danger-ghost button-block" disabled={uploadingId === activeRepo.id || archiveRepository.isPending} onClick={() => setDeleteRepoModal(true)}><Trash2 size={16}/> حذف المستودع</button><input id={`upload-${activeRepo.id}`} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={e => void handleUpload(e, activeRepo.id)}/></div><div className="detail-divider"/><div className="detail-section-title"><strong>نسخ المستودع</strong><span>{versions.data?.length ?? 0}</span></div>{versions.isLoading ? <p className="muted-copy">جارٍ تحميل النسخ…</p> : (versions.data ?? []).length ? <div className="version-list">{(versions.data ?? []).slice(0, 5).map(version => <div className="version-row" key={version.id}><span className="version-dot"/><div className="version-copy"><strong>نسخة {version.versionNumber}</strong><small>{version.actorName} · {timeAgo(version.createdAt)}</small></div><button className="icon-button" title="تنزيل النسخة" onClick={() => void download(version.id)}><ArrowDownToLine size={15}/></button><button className="icon-button" title="استعادة هذه النسخة" onClick={() => restore.mutate({ id: activeRepo.id, versionId: version.id })}><RotateCcw size={15}/></button></div>)}</div> : <p className="muted-copy">لم تُرفع ملفات بعد. ارفع ZIP لبدء سجل النسخ.</p>}<div className="detail-divider"/><div className="detail-section-title"><strong>مهام المشروع</strong><button className="text-button text-button-small" onClick={() => { setSection("tasks"); setTaskModal(true); }}><Plus size={14}/> إضافة</button></div>{(tasks.data ?? []).slice(0, 3).map(task => <div className="mini-task" key={task.id}><span className={`task-check ${task.status === "done" ? "task-done" : ""}`}>{task.status === "done" && <Check size={12}/>}</span><span>{task.title}</span><small className={`task-status status-${task.status}`}>{statusLabels[task.status]}</small></div>)}{!tasks.data?.length && <p className="muted-copy">لا توجد مهام بعد.</p>}</> : <EmptyState icon={<FolderGit2 size={21}/>} title="اختر مستودعًا" body="حدد مشروعًا من القائمة لتفاصيله ونسخه ومهامه."/>}</aside></div>}

        {section === "tasks" && !repos.isLoading && <section className="surface main-panel"><div className="surface-heading"><div><span className="eyebrow">لوحة العمل</span><h2>المهام المشتركة</h2></div><div className="heading-actions"><select className="select-control" value={activeRepo?.id ?? ""} onChange={e => setSelectedRepoId(e.target.value)} aria-label="اختر مستودعًا">{(repos.data ?? []).map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select><button className="button button-primary" disabled={!activeRepo} onClick={() => setTaskModal(true)}><Plus size={16}/> مهمة جديدة</button></div></div>{!activeRepo ? <EmptyState icon={<CheckCircle2 size={23}/>} title="ابدأ بإنشاء مستودع" body="المهام مرتبطة بمستودع حتى يتمكن الوكلاء من رؤية سياقها." action={<button className="button button-primary" onClick={openCreateRepo}><Plus size={16}/> مشروع جديد</button>}/> : tasks.isLoading ? <div className="panel-loading"><LoaderCircle className="spin" size={20}/> جارٍ تحميل المهام…</div> : (tasks.data ?? []).length ? <div className="task-board">{["open", "in_progress", "done"].map(statusKey => <div className="task-column" key={statusKey}><div className="task-column-head"><span className={`column-marker marker-${statusKey}`}/><strong>{statusLabels[statusKey]}</strong><span>{(tasks.data ?? []).filter(task => task.status === statusKey).length}</span></div>{(tasks.data ?? []).filter(task => task.status === statusKey).map(task => <article className="task-card" key={task.id}><div className="task-card-top"><span className="task-id">{task.id.slice(0, 6).toUpperCase()}</span><button className="icon-button" title="تغيير الحالة" onClick={() => updateTask.mutate({ repositoryId: activeRepo.id, taskId: task.id, status: task.status === "open" ? "in_progress" : task.status === "in_progress" ? "done" : "open" })}><MoreHorizontal size={16}/></button></div><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}<div className="task-card-foot"><span><Bot size={13}/>{task.assignedAgent || "بانتظار وكيل"}</span><small>{timeAgo(task.updatedAt)}</small></div><div className="task-card-controls">{task.status !== "done" && <button className="text-button text-button-small" onClick={() => updateTask.mutate({ repositoryId: activeRepo.id, taskId: task.id, status: task.status === "open" ? "in_progress" : "done" })}>{task.status === "open" ? "بدء المهمة" : "إكمال المهمة"}<ArrowLeft size={13}/></button>}</div></article>)}</div>)}</div> : <EmptyState icon={<CheckCircle2 size={23}/>} title="مساحة المهام فارغة" body="حوّل العمل إلى مهام واضحة يستطيع الوكلاء استلامها ومتابعتها." action={<button className="button button-primary" onClick={() => setTaskModal(true)}><Plus size={16}/> إنشاء أول مهمة</button>}/>}</section>}

        {section === "agents" && <div className="agents-page"><section className="surface agent-intro"><div className="agent-intro-copy"><span className="eyebrow">تكامل آمن · تحكم كامل</span><h2>أربعة مفاتيح منفصلة.<br/><em>كلٌ لمهمته.</em></h2><p>أنشئ مفتاح إدارة عامة يتيح رؤية وفتح وإدارة جميع مستودعات وصل، أو مفتاح تصدير يرسله الوكيل إلى GitHub، أو مفتاحًا يقتصر على تعديل مستودع واحد، أو مفتاح رفع ينشئ مستودعًا واحدًا عند أول رفع. لكل نوع برومبت مستقل وصلاحيات واضحة.</p><button className="button button-primary" onClick={() => setKeyModal(true)}><KeyRound size={16}/> إنشاء مفتاح وبرومبت</button></div><div className="agent-illustration"><div className="ring ring-one"/><div className="ring ring-two"/><span className="agent-node node-one"><Code2 size={17}/></span><span className="agent-node node-two"><Bot size={17}/></span><span className="agent-node node-three"><FolderGit2 size={17}/></span><span className="agent-core"><Mark small/></span></div></section><div className="notice notice-warning"><ShieldCheck size={18}/><p><strong>أربعة أنواع بصلاحيات منفصلة.</strong> إدارة عامة لجميع مشاريع وصل، أو تصدير GitHub، أو تعديل مستودع محدد، أو رفع مشروع واحد إلى وصل. خزّن كل سر لدى مزود الوكيل وألغِه فور الاشتباه بتسربه.</p></div><section className="surface keys-surface"><div className="surface-heading"><div><span className="eyebrow">إدارة الوصول</span><h2>مفاتيح الوكلاء <span className="heading-count">{connectedKeys.length}</span></h2></div><button className="button button-secondary" onClick={() => setKeyModal(true)}><Plus size={16}/> مفتاح جديد</button></div>{keys.isLoading ? <div className="panel-loading"><LoaderCircle className="spin" size={18}/> جارٍ تحميل المفاتيح…</div> : (keys.data ?? []).length ? <div className="key-list">{(keys.data ?? []).map(key => <article className={`key-row ${key.revokedAt || key.scopedRepositoryArchivedAt ? "key-revoked" : ""}`} key={key.id}><span className="key-icon"><KeyRound size={18}/></span><div className="key-info"><strong>{key.label}</strong><code>{key.tokenPrefix}••••••••</code><small className="eyebrow">{key.scope === "github_upload" ? "رفع GitHub · تصدير فقط" : key.scope === "repository_edit" ? `تعديل مستودع · ${key.scopedRepositoryName ?? "مستودع محدد"}` : key.scope === "repository_upload" ? (key.scopedRepositoryName ? `رفع إلى وصل · ${key.scopedRepositoryName}` : "رفع إلى وصل · ينتظر أول رفع") : "إدارة عامة · جميع المشاريع"}</small></div><span className={`key-status ${key.revokedAt || key.scopedRepositoryArchivedAt ? "key-status-off" : ""}`}><i/>{key.revokedAt ? "ملغى" : key.scopedRepositoryArchivedAt ? "المستودع مؤرشف" : key.scope === "repository_upload" && !key.scopedRepositoryId ? "بانتظار أول رفع" : "نشط"}</span><span className="key-lastused">{key.lastUsedAt ? `آخر اتصال ${timeAgo(key.lastUsedAt)}` : "لم يتصل بعد"}</span>{!key.revokedAt && <button className="button button-small button-danger-ghost" onClick={() => revokeKey.mutate({ id: key.id })}><X size={14}/> إلغاء المفتاح</button>}</article>)}</div> : <EmptyState icon={<Bot size={23}/>} title="لا يوجد وكلاء مرتبطون" body="أنشئ مفتاحًا لتوليد برومبت الربط المناسب ثم أرسله إلى وكيلك." action={<button className="button button-primary" onClick={() => setKeyModal(true)}><Plus size={16}/> إعداد أول وكيل</button>}/>}</section><section className="surface api-guide"><div className="surface-heading"><div><span className="eyebrow">للمطورين</span><h2>كيف يعمل الربط؟</h2></div><span className="surface-icon"><TerminalSquare size={18}/></span></div><div className="guide-steps"><div><b>01</b><strong>أصدر المفتاح المناسب</strong><p>إدارة عامة لجميع المشاريع، تصدير GitHub، تعديل مستودع تختاره، أو رفع مشروع واحد؛ يظهر الرمز مرة واحدة.</p></div><div><b>02</b><strong>انسخ البرومبت</strong><p>يشرح كل برومبت نقطة API والصلاحيات الممنوحة للمفتاح فقط.</p></div><div><b>03</b><strong>اترك الوكيل يعمل</strong><p>كل نسخة ورسالة ومهمة تظهر في نشاط مشترك ويمكن الرجوع إلى النسخ السابقة.</p></div></div></section></div>}

        {section === "activity" && <section className="surface main-panel"><div className="surface-heading"><div><span className="eyebrow">شفافية العمل</span><h2>كل ما حدث في حسابك</h2></div><button className="button button-secondary" onClick={() => void allActivity.refetch()}><RefreshCw size={15}/> تحديث السجل</button></div><ActivityList items={allActivity.data ?? []} repositories={repos.data ?? []}/></section>}
      </main>
      <footer className="page-footer"><span>وصل <b>•</b> مساحة تطوير تعاونية</span><span>المشروع والوكيل على المسار نفسه <span className="footer-spark">✳</span></span></footer>
    </div>

    {repoModal && <Modal title="أنشئ مستودعًا جديدًا" eyebrow="مشروع جديد" onClose={() => setRepoModal(false)}><form className="form-stack" onSubmit={onCreateRepository}><label>اسم المشروع<input autoFocus value={newRepoName} onChange={e => setNewRepoName(e.target.value)} placeholder="مثال: منصة متجر إلكتروني" maxLength={120} required/></label><label>وصف مختصر <span className="optional-label">اختياري</span><textarea value={newRepoDescription} onChange={e => setNewRepoDescription(e.target.value)} placeholder="ما الذي يبنيه هذا المشروع؟ أضف سياقًا يفيد الوكلاء." rows={3} maxLength={2000}/></label><div className="form-note"><Archive size={15}/> المستودع خاص بحسابك، ويمكن لوكلائك الوصول إليه عبر مفتاح API.</div><button className="button button-primary button-block" disabled={createRepo.isPending}>{createRepo.isPending ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} إنشاء المستودع</button></form></Modal>}

    {deleteRepoModal && activeRepo && <Modal title="تأكيد حذف المستودع" eyebrow="سيُنقل إلى الأرشيف" onClose={() => { if (!archiveRepository.isPending) setDeleteRepoModal(false); }}><div className="form-stack"><div className="notice notice-warning"><Trash2 size={17}/><p>سيتم إخفاء «<strong>{activeRepo.name}</strong>» من قائمة المستودعات النشطة. تبقى ملفات المشروع ونسخه محفوظة في الأرشيف ولا تُمحى نهائيًا، وتتعطل المفاتيح المقيدة به.</p></div><button type="button" className="button button-secondary button-block" onClick={() => setDeleteRepoModal(false)} disabled={archiveRepository.isPending}>إلغاء</button><button type="button" className="button button-danger-ghost button-block" onClick={() => archiveRepository.mutate({ id: activeRepo.id })} disabled={archiveRepository.isPending || uploadingId === activeRepo.id}>{archiveRepository.isPending ? <LoaderCircle className="spin" size={16}/> : <Trash2 size={16}/>} تأكيد الحذف ونقل المستودع إلى الأرشيف</button></div></Modal>}

    {keyModal && <Modal title={keyScope === "github_upload" ? "إنشاء مفتاح تصدير GitHub" : keyScope === "repository_edit" ? "إنشاء مفتاح تعديل مستودع" : keyScope === "repository_upload" ? "إنشاء مفتاح رفع إلى وصل" : "إنشاء مفتاح الإدارة العامة"} eyebrow="اختر نوع المفتاح والبرومبت" onClose={() => setKeyModal(false)}><form className="form-stack" onSubmit={onCreateKey}><label>نوع المفتاح<select value={keyScope} onChange={e => { const scope = e.target.value as "full" | "github_upload" | "repository_edit" | "repository_upload"; setKeyScope(scope); if (scope === "repository_edit") setKeyRepositoryId(selectedRepoId ?? repos.data?.[0]?.id ?? ""); }}><option value="full">إدارة عامة — جميع مشاريع الحساب</option><option value="github_upload">رفع GitHub — تصدير محدود للوكيل</option><option value="repository_edit">تعديل مستودع واحد فقط</option><option value="repository_upload">رفع مشروع جديد إلى وصل — مستودع واحد</option></select></label>{keyScope === "repository_edit" && <label>المستودع المسموح<input list="repository-key-options" value={repos.data?.find(repo => repo.id === keyRepositoryId)?.name ?? ""} onChange={e => { const repository = repos.data?.find(repo => repo.name === e.target.value); setKeyRepositoryId(repository?.id ?? ""); }} placeholder="اختر مستودعًا نشطًا" required/><datalist id="repository-key-options">{(repos.data ?? []).map(repo => <option key={repo.id} value={repo.name}/>)}</datalist><small className="muted-copy">يُقيّد المفتاح خادميًا إلى هذا المستودع وحده؛ لا يستطيع الوكيل تبديل المعرّف.</small></label>}<label>اسم تعريفي للمفتاح<input autoFocus value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder={keyScope === "github_upload" ? "مثال: وكيل نشر GitHub" : keyScope === "repository_edit" ? "مثال: وكيل المشروع المحدد" : keyScope === "repository_upload" ? "مثال: وكيل رفع المشروع" : "مثال: وكيل Codex"} maxLength={80} required/></label><div className="key-warning"><ShieldCheck size={17}/><p>{keyScope === "repository_upload" ? <><strong>رفع محدود إلى وصل.</strong> ينشئ المستودع ويربطه بهذا المفتاح عند أول رفع ZIP صالح؛ بعدها يقتصر على تنزيل ورفع نسخ المستودع نفسه. لا يستطيع إنشاء مشروع ثانٍ أو تعديل بيانات المشروع أو مهامه أو أرشفته. </> : keyScope === "github_upload" ? <><strong>تصدير فقط.</strong> يستطيع الوكيل عرض مشاريعك وتنزيل ZIP وتسجيل رابط النشر؛ لا يستطيع تعديل مشاريع وصل. يستخدم اتصال GitHub الموجود في بيئة الوكيل.</> : keyScope === "repository_edit" ? <><strong>تعديل مستودع واحد.</strong> يستطيع الوكيل قراءة المشروع المحدد وتعديل بياناته ورفع ZIP وإدارة مهامه ورسائله واستعادة نسخه؛ لا يرى بقية مشاريع الحساب ولا يستطيع إنشاء أو أرشفة مستودعات.</> : <><strong>إدارة عامة لحسابك في وصل.</strong> يستطيع الوكيل عرض كل المشاريع وفتح تفاصيلها وتنزيل ملفاتها، وإنشاء المشاريع وتعديلها ورفع النسخ وإدارة المهام والرسائل والأرشفة واستعادة النسخ. لا يمنحه ذلك صلاحية GitHub.</>} سيُعرض المفتاح والبرومبت مرة واحدة فقط.</p></div><button className="button button-primary button-block" disabled={createKey.isPending || (keyScope === "repository_edit" && !keyRepositoryId)}>{createKey.isPending ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {keyScope === "github_upload" ? "إنشاء مفتاح GitHub وبرومبته" : keyScope === "repository_edit" ? "إنشاء مفتاح المستودع وبرومبته" : keyScope === "repository_upload" ? "إنشاء مفتاح رفع وصل وبرومبته" : "إنشاء مفتاح الإدارة العامة وبرومبته"}</button></form></Modal>}

    {taskModal && <Modal title="أضف مهمة للمشروع" eyebrow={activeRepo?.name} onClose={() => setTaskModal(false)}><form className="form-stack" onSubmit={onCreateTask}><label>عنوان المهمة<input autoFocus value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="مثال: إعداد صفحة تسجيل الدخول" maxLength={180} required/></label><label>السياق والتفاصيل <span className="optional-label">اختياري</span><textarea rows={4} value={taskDescription} onChange={e => setTaskDescription(e.target.value)} placeholder="أضف سياقًا يساعد الوكيل على تنفيذ المهمة…" maxLength={4000}/></label><div className="form-note"><Bot size={15}/> سيتمكن الوكلاء المتصلون من رؤية المهمة وتحديث حالتها.</div><button className="button button-primary button-block" disabled={createTask.isPending || !activeRepo}>{createTask.isPending ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} إضافة المهمة</button></form></Modal>}

    {freshCredential && <Modal title={freshCredential.scope === "github_upload" ? "مفتاح تصدير GitHub وبرومبته جاهزان" : freshCredential.scope === "repository_edit" ? "مفتاح المستودع وبرومبته جاهزان" : freshCredential.scope === "repository_upload" ? "مفتاح رفع وصل وبرومبته جاهزان" : "مفتاح الإدارة العامة وبرومبته جاهزان"} eyebrow="احفظهما الآن — لن يظهر المفتاح مرة أخرى" onClose={() => setFreshCredential(null)} wide><div className="fresh-secret"><div className="fresh-secret-head"><span className="secret-pulse"><KeyRound size={16}/></span><div><strong>{freshCredential.scope === "github_upload" ? "رمز تصدير محدود" : freshCredential.scope === "repository_edit" ? `تعديل محدود · ${freshCredential.repositoryName}` : freshCredential.scope === "repository_upload" ? "رمز رفع لمستودع واحد" : "رمز إدارة عامة لجميع المشاريع"}</strong><small>استخدم المفتاح والبرومبت الموافق لنوعه</small></div></div><div className="secret-value"><code>{freshCredential.token}</code><button className="icon-button" title="نسخ المفتاح" onClick={() => { void navigator.clipboard.writeText(freshCredential.token); toast.success("نُسخ المفتاح"); }}><Copy size={16}/></button></div><div className="prompt-head"><div><strong>برومبت جاهز للوكيل</strong><small>{freshCredential.scope === "github_upload" ? "يوجّه الوكيل لتنزيل المشروع ورفعه إلى GitHub عبر اتصاله" : freshCredential.scope === "repository_edit" ? "يمنح الوكيل وصولًا إلى المستودع المختار فقط" : freshCredential.scope === "repository_upload" ? "يشرح إنشاء مستودع واحد عند أول رفع ثم يقيّد كل الرفعات به" : "يشرح رؤية جميع مشاريع وصل وفتح تفاصيلها وإدارتها"}</small></div><button className="button button-small button-secondary" onClick={() => { void navigator.clipboard.writeText(freshCredential.prompt); toast.success("نُسخ البرومبت كاملًا"); }}><Copy size={14}/> نسخ البرومبت كاملًا</button></div><textarea className="prompt-output" readOnly value={freshCredential.prompt} onFocus={e => e.currentTarget.select()} rows={12}/><div className="notice notice-warning compact-warning"><ShieldCheck size={16}/><p>يتضمن النص سر المفتاح. أرسل المفتاح والبرومبت إلى الوكيل المقصود فقط؛ مفتاح المستودع الواحد لا يستطيع الوصول إلى مشروع آخر.</p></div><button className="button button-primary button-block" onClick={() => setFreshCredential(null)}><Check size={16}/> حفظت المفتاح والبرومبت</button></div></Modal>}
  </div>;
}

function ActivityList({ items, repositories }: { items: Array<{ id: string; repositoryId: string; actorType: string; actorName: string; kind: string; message: string; createdAt: Date }>; repositories: Array<{ id: string; name: string }> }) {
  if (!items.length) return <EmptyState icon={<Activity size={22}/>} title="لا يوجد نشاط حتى الآن" body="سيظهر هنا إنشاء المشاريع ورفع النسخ والمهام ورسائل الوكلاء."/>;
  const kinds: Record<string, string> = { created: "مشروع", upload: "رفع", version: "نسخة", task: "مهمة", comment: "رسالة", restore: "استعادة" };
  return <div className="activity-list">{items.map(item => <div className="activity-row" key={item.id}><span className={`activity-icon activity-${item.kind}`}>{item.actorType === "agent" ? <Bot size={16}/> : item.kind === "upload" || item.kind === "version" ? <ArrowUpFromLine size={16}/> : item.kind === "task" ? <CheckCircle2 size={16}/> : <Activity size={16}/>}</span><div className="activity-copy"><p><strong>{item.actorName}</strong> <span className="activity-action">{kinds[item.kind] ?? "نشاط"}</span> — {item.message}</p><div className="activity-meta"><span>{repositories.find(repo => repo.id === item.repositoryId)?.name ?? "مستودع مؤرشف"}</span><span>·</span><time>{timeAgo(item.createdAt)}</time></div></div><span className={`actor-pill ${item.actorType === "agent" ? "actor-agent" : ""}`}>{item.actorType === "agent" ? "وكيل" : item.actorType === "system" ? "النظام" : "أنت"}</span></div>)}</div>;
}

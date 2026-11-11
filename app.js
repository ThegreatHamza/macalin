import { sb, $, $$, e, djf, fmtDate, waLink, toast, errMsg, state, loadSession, ensureProfile,
  route, go, render, startRouter, formData, busy, uploadPhoto, authPage, paymentPage, adminPayments } from './lib.js';

const SUBJECTS = ['Mathématiques', 'Physique-Chimie', 'SVT', 'Français', 'Anglais', 'Arabe', 'Histoire-Géographie', 'Philosophie',
  'Économie', 'Comptabilité', 'Informatique', 'Dessin technique', 'Somali', 'Coran', 'Préparation concours'];
const LEVELS = ['Primaire', 'CEPE', 'Collège', 'BEF', 'Lycée', 'Bac', 'Bac Pro', 'Université', 'Adultes'];
const DISTRICTS = ['Plateau du Serpent', 'Héron', 'Haramous', 'Centre-ville', 'Gabode', 'Salines', 'Cité Hodan', 'Einguela',
  'Arhiba', 'Ambouli', 'Cité Djebel', 'Balbala', 'PK12', 'Arta', 'Tadjourah', 'Ali Sabieh', 'Dikhil', 'En ligne'];
const LANGS = ['Français', 'Somali', 'Afar', 'Arabe', 'Anglais'];
const MODES = { home: 'À domicile', online: 'En ligne', both: 'Domicile + en ligne' };
const PRODUCTS = {
  sub_month: { label: 'Abonnement professeur — 1 mois', price: 3000 },
  sub_quarter: { label: 'Abonnement professeur — 3 mois', price: 7500 },
  featured_30d: { label: 'Profil en vedette — 30 jours', price: 5000 }
};
const today = () => new Date().toISOString().slice(0, 10);

async function refresh() { await loadSession('mac_profiles'); paintNav(); }
function paintNav() {
  $('#nav').innerHTML = `
    <a href="#/">Trouver un prof</a>
    ${state.user ? `${state.profile?.role === 'tutor' ? '<a href="#/prof">Mon espace prof</a>' : ''}${state.profile?.is_admin ? '<a href="#/admin">Admin</a>' : ''}<a href="#" id="logout">Sortir</a>`
                 : '<a href="#/login">Connexion</a>'}
    <a class="cta" href="#/devenir-prof">Devenir professeur</a>`;
  const lo = $('#logout'); if (lo) lo.onclick = async ev => { ev.preventDefault(); await sb.auth.signOut(); await refresh(); go('/'); };
}
const stars = (avg, n) => n ? `<span class="stars">★ ${Number(avg).toFixed(1)}</span> <span class="muted small">(${n})</span>` : '<span class="muted small">Nouveau</span>';

function tutorCard(t) {
  return `<a class="tcard" href="#/t/${t.id}">
    <div class="avatar" style="${t.photo_url ? `background-image:url('${e(t.photo_url)}')` : ''}">${t.photo_url ? '' : e(t.display_name[0])}</div>
    <div><div class="name">${e(t.display_name)} ${t.verified ? '<span title="Diplômes vérifiés">✔</span>' : ''} ${t.featured_now ? '<span class="badge featured">Vedette</span>' : ''}</div>
      <div class="small">${e(t.headline)}</div>
      <div class="muted small">${e(t.subjects.slice(0, 3).join(' · '))} — ${e(t.levels.slice(0, 3).join(', '))}</div>
      <div class="row-line"><b>${djf(t.hourly_rate_djf)}</b><span class="muted small">/h</span> · ${stars(t.rating_avg, t.rating_count)}</div></div></a>`;
}

// ---------- Search ----------
route('/', async (view, _, q) => {
  view.innerHTML = `
  <section class="hero">
    <h1>Le bon professeur particulier, près de chez vous</h1>
    <p>Soutien scolaire et préparation CEPE, BEF et Bac à Djibouti. Professeurs vérifiés, à domicile ou en ligne.</p>
    <form id="s" class="row searchbar">
      <label>Matière<select name="subject"><option value="">Toutes</option>${SUBJECTS.map(s => `<option ${q.subject === s ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></label>
      <label>Niveau<select name="level"><option value="">Tous</option>${LEVELS.map(s => `<option ${q.level === s ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></label>
      <label>Quartier<select name="district"><option value="">Tous</option>${DISTRICTS.map(s => `<option ${q.district === s ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></label>
      <label>Budget max/h<input type="number" name="max" min="0" step="500" value="${e(q.max || '')}"></label>
      <button class="btn accent">Rechercher</button>
    </form>
  </section><div id="res"><div class="loading">Chargement…</div></div>`;
  $('#s').onsubmit = ev => { ev.preventDefault(); go('/?' + new URLSearchParams(Object.entries(formData(ev.target)).filter(([, v]) => v)).toString()); };
  let query = sb.from('mac_directory').select('*').order('featured_now', { ascending: false }).order('rating_avg', { ascending: false }).limit(60);
  if (q.subject) query = query.contains('subjects', [q.subject]);
  if (q.level) query = query.contains('levels', [q.level]);
  if (q.district) query = query.contains('districts', [q.district]);
  if (q.max) query = query.lte('hourly_rate_djf', Number(q.max));
  const { data, error } = await query;
  if (error) throw error;
  $('#res').innerHTML = data.length ? `<p class="muted">${data.length} professeur(s)</p><div class="grid">${data.map(tutorCard).join('')}</div>`
    : '<div class="card empty">Aucun professeur ne correspond. <a href="#/">Élargir la recherche</a></div>';
});

// ---------- Tutor profile + request ----------
route('/t/:id', async (view, { id }) => {
  const [{ data: t, error }, { data: reviews }] = await Promise.all([
    sb.from('mac_directory').select('*').eq('id', id).maybeSingle(),
    sb.from('mac_reviews').select('*').eq('tutor_id', id).order('created_at', { ascending: false }).limit(30)
  ]);
  if (error) throw error;
  if (!t) { view.innerHTML = '<div class="card">Profil indisponible.</div>'; return; }
  const canReview = state.user && state.user.id !== id && !reviews.some(r => r.author_id === state.user.id);
  view.innerHTML = `<a href="#/" class="muted">← Retour</a>
  <div class="split" style="margin-top:.6rem"><div>
    <div class="card"><div class="tcard flat">
      <div class="avatar big" style="${t.photo_url ? `background-image:url('${e(t.photo_url)}')` : ''}">${t.photo_url ? '' : e(t.display_name[0])}</div>
      <div><h2 style="margin:0">${e(t.display_name)} ${t.verified ? '<span class="badge active">Diplômes vérifiés</span>' : ''}</h2>
      <p style="margin:.2rem 0">${e(t.headline)}</p>${stars(t.rating_avg, t.rating_count)}</div></div>
      <p class="price-big">${djf(t.hourly_rate_djf)} <small class="muted">/ heure</small></p>
      <p><b>Matières :</b> ${e(t.subjects.join(', '))}<br><b>Niveaux :</b> ${e(t.levels.join(', '))}<br>
        <b>Quartiers :</b> ${e(t.districts.join(', '))}<br><b>Format :</b> ${MODES[t.teach_mode]}<br>
        <b>Langues :</b> ${e(t.languages.join(', '))}<br><b>Expérience :</b> ${t.experience_years} an(s)</p>
      <p style="white-space:pre-line">${e(t.bio)}</p></div>
    <div class="card"><h3>Avis des parents</h3>
      ${reviews.map(r => `<div class="review"><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <span class="muted small">${fmtDate(r.created_at)}</span><p>${e(r.comment)}</p></div>`).join('') || '<p class="muted">Pas encore d\'avis.</p>'}
      ${canReview ? `<form id="rv"><h4>Laisser un avis</h4><label>Note<select name="rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${n} ★</option>`).join('')}</select></label>
        <label>Commentaire<textarea name="comment" maxlength="600"></textarea></label><button class="btn ghost">Publier l'avis</button></form>`
        : state.user ? '' : '<p class="small"><a href="#/login">Connectez-vous</a> pour laisser un avis.</p>'}
    </div></div>
    <aside><div class="card"><h3>Demander un cours</h3>
      <form id="rq">
        <label>Votre nom (parent ou élève)<input name="parent_name" required minlength="2"></label>
        <label>Téléphone / WhatsApp<input name="phone" type="tel" required minlength="6"></label>
        <label>Niveau de l'élève<select name="student_level">${t.levels.map(l => `<option>${e(l)}</option>`).join('')}</select></label>
        <label>Matière<select name="subject">${t.subjects.map(l => `<option>${e(l)}</option>`).join('')}</select></label>
        <label>Quartier<select name="district">${DISTRICTS.map(l => `<option>${e(l)}</option>`).join('')}</select></label>
        <label>Message<textarea name="message" maxlength="1000" placeholder="Jours disponibles, objectifs (ex. Bac en juin)…"></textarea></label>
        <button class="btn primary" style="width:100%">Envoyer la demande</button>
      </form>
      ${t.whatsapp ? `<a class="btn wa" style="width:100%;margin-top:.5rem" target="_blank" rel="noopener" href="${waLink(t.whatsapp, `Bonjour ${t.display_name}, je vous ai trouvé sur Macalin. Je cherche des cours de…`)}">WhatsApp direct</a>` : ''}
    </div></aside></div>`;
  $('#rq').onsubmit = async ev => {
    ev.preventDefault();
    const b = $('#rq button'); busy(b, true);
    const { error } = await sb.from('mac_requests').insert({ tutor_id: id, ...formData(ev.target) });
    busy(b, false);
    if (error) return toast(errMsg(error), 'err');
    ev.target.reset(); toast('Demande envoyée ! Le professeur vous rappelle rapidement.');
  };
  const rv = $('#rv');
  if (rv) rv.onsubmit = async ev => {
    ev.preventDefault();
    if (!state.profile) await ensureProfile('mac_profiles', { full_name: state.user.user_metadata?.full_name || '', role: 'parent' });
    const f = formData(ev.target);
    const { error } = await sb.from('mac_reviews').insert({ tutor_id: id, author_id: state.user.id, rating: Number(f.rating), comment: f.comment });
    error ? toast(errMsg(error), 'err') : (toast('Merci pour votre avis'), render());
  };
});

// ---------- Auth ----------
route('/login', async (view, _, q) => {
  if (state.user) return go(state.profile?.role === 'tutor' ? '/prof' : '/');
  authPage(view, {
    title: q.prof ? 'Créez votre compte professeur' : 'Connexion',
    extraSignup: `<label>Je suis<select name="role"><option value="parent" ${q.prof ? '' : 'selected'}>Parent / élève</option><option value="tutor" ${q.prof ? 'selected' : ''}>Professeur</option></select></label>`,
    onDone: async f => {
      await refresh();
      if (!state.profile) await ensureProfile('mac_profiles', { full_name: f.full_name || '', phone: f.phone || '', role: f.role || 'parent' });
      await refresh(); go(state.profile.role === 'tutor' ? '/prof' : '/');
    }
  });
});

route('/devenir-prof', async view => {
  view.innerHTML = `<div class="card" style="max-width:760px;margin:auto"><h2>Donnez des cours avec Macalin</h2>
    <ul><li>Recevez des demandes de parents de votre quartier directement par téléphone.</li>
    <li><b>1 mois gratuit</b> après validation de votre profil, puis 3 000 FDJ/mois (ou 7 500 FDJ / 3 mois).</li>
    <li>Vous fixez votre tarif. Les parents vous paient directement — aucune commission sur vos cours.</li>
    <li>Badge « Diplômes vérifiés » après contrôle de vos diplômes.</li></ul>
    <a class="btn primary" href="${state.user ? '#/prof' : '#/login?prof=1'}">Créer mon profil professeur</a></div>`;
});

// ---------- Tutor dashboard ----------
route('/prof', async (view, _, q) => {
  if (!state.user) return go('/login?prof=1');
  if (!state.profile) { const md = state.user.user_metadata || {}; await ensureProfile('mac_profiles', { full_name: md.full_name || '', phone: md.phone || '', role: 'tutor' }); }
  if (state.profile.role !== 'tutor') await ensureProfile('mac_profiles', { role: 'tutor' });
  await refresh();
  const { data: t } = await sb.from('mac_tutors').select('*').eq('id', state.user.id).maybeSingle();
  const tab = !t ? 'profil' : (q.t || 'req');
  const live = t && t.status === 'active' && t.subscribed_until >= today();
  view.innerHTML = `<div class="card">
    <h2 style="margin:0">Espace professeur</h2>
    ${t ? `<p class="small">Statut : <span class="badge ${t.status}">${t.status}</span>
      ${t.status === 'active' ? (live ? ` · visible jusqu'au <b>${fmtDate(t.subscribed_until)}</b>` : ' · <b>abonnement expiré — profil masqué</b>') : ' · en cours de vérification (24–48 h)'}
      ${t.featured_until && new Date(t.featured_until) > new Date() ? ` · <span class="badge featured">Vedette jusqu'au ${fmtDate(t.featured_until)}</span>` : ''}</p>
      <a class="btn accent sm" href="#/pay?product=sub_month">Prolonger 1 mois — 3 000 FDJ</a>
      <a class="btn ghost sm" href="#/pay?product=sub_quarter">3 mois — 7 500 FDJ</a>
      <a class="btn ghost sm" href="#/pay?product=featured_30d">★ Vedette 30 j — 5 000 FDJ</a>` : '<p>Complétez votre profil pour être publié.</p>'}
    <div class="tabs" style="margin-top:1rem">
      ${t ? `<a class="tab ${tab === 'req' ? 'active' : ''}" href="#/prof?t=req">Demandes</a>` : ''}
      <a class="tab ${tab === 'profil' ? 'active' : ''}" href="#/prof?t=profil">Mon profil</a>
      ${t ? `<a class="tab ${tab === 'pay' ? 'active' : ''}" href="#/prof?t=pay">Paiements</a>` : ''}
    </div><div id="pane"></div></div>`;
  const pane = $('#pane');
  if (tab === 'req') {
    const { data } = await sb.from('mac_requests').select('*').eq('tutor_id', t.id).order('created_at', { ascending: false });
    pane.innerHTML = data.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Parent</th><th>Cours</th><th>Message</th><th>Statut</th></tr></thead><tbody>
      ${data.map(r => `<tr><td>${fmtDate(r.created_at)}</td><td>${e(r.parent_name)}<br><a target="_blank" rel="noopener" href="${waLink(r.phone, `Bonjour ${r.parent_name}, je suis ${t.display_name} (Macalin). Suite à votre demande de cours de ${r.subject}…`)}">${e(r.phone)}</a></td>
      <td>${e(r.subject)} · ${e(r.student_level)}<br><span class="small muted">${e(r.district)}</span></td><td class="small">${e(r.message)}</td>
      <td><select data-st="${r.id}">${['new', 'contacted', 'started', 'declined'].map(s => `<option ${r.status === s ? 'selected' : ''} value="${s}">${{ new: 'Nouveau', contacted: 'Contacté', started: 'Cours commencés', declined: 'Refusé' }[s]}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Pas encore de demandes. Partagez le lien de votre profil sur WhatsApp !</p>';
    $$('[data-st]', pane).forEach(s => s.onchange = async () => {
      const { error } = await sb.from('mac_requests').update({ status: s.value }).eq('id', s.dataset.st);
      toast(error ? errMsg(error) : 'Mis à jour', error ? 'err' : 'ok');
    });
    return;
  }
  if (tab === 'pay') {
    const { data } = await sb.from('mac_payments').select('*').eq('user_id', t.id).order('created_at', { ascending: false });
    pane.innerHTML = data.length ? `<table class="tbl"><tbody>${data.map(x => `<tr><td>${fmtDate(x.created_at)}</td><td>${e(PRODUCTS[x.product].label)}</td><td>${djf(x.amount_djf)}</td><td><span class="badge ${x.status}">${x.status}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun paiement.</p>';
    return;
  }
  const v = t || { display_name: state.profile.full_name, headline: '', bio: '', subjects: [], levels: [], districts: [], languages: ['Français'], teach_mode: 'home', hourly_rate_djf: 2000, experience_years: 0, whatsapp: state.profile.phone, photo_url: '' };
  let photo = v.photo_url;
  const checks = (name, list, sel) => `<div class="checks">${list.map(x => `<label><input type="checkbox" name="${name}" value="${e(x)}" ${sel.includes(x) ? 'checked' : ''}> ${e(x)}</label>`).join('')}</div>`;
  pane.innerHTML = `<form id="tf">
    <div class="row"><label>Nom affiché<input name="display_name" required minlength="2" value="${e(v.display_name)}"></label>
      <label>WhatsApp<input name="whatsapp" value="${e(v.whatsapp)}"></label></div>
    <label>Accroche<input name="headline" maxlength="140" value="${e(v.headline)}" placeholder="ex. Professeur de maths au lycée, 8 ans d'expérience, 92 % de réussite au Bac"></label>
    <label>Photo<input type="file" id="ph" accept="image/*"></label><div id="phv">${photo ? `<img src="${e(photo)}" style="width:90px;height:90px;object-fit:cover;border-radius:50%">` : ''}</div>
    <label>Matières</label>${checks('subjects', SUBJECTS, v.subjects)}
    <label>Niveaux</label>${checks('levels', LEVELS, v.levels)}
    <label>Quartiers où vous vous déplacez</label>${checks('districts', DISTRICTS, v.districts)}
    <label>Langues d'enseignement</label>${checks('languages', LANGS, v.languages)}
    <div class="row"><label>Format<select name="teach_mode">${Object.entries(MODES).map(([k, x]) => `<option value="${k}" ${v.teach_mode === k ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Tarif horaire (FDJ)<input type="number" name="hourly_rate_djf" min="500" max="50000" step="100" required value="${e(v.hourly_rate_djf)}"></label>
      <label>Années d'expérience<input type="number" name="experience_years" min="0" max="50" value="${e(v.experience_years)}"></label></div>
    <label>Présentation<textarea name="bio" maxlength="2000" rows="6" placeholder="Diplômes, méthode, résultats de vos élèves…">${e(v.bio)}</textarea></label>
    <button class="btn primary">${t ? 'Enregistrer' : 'Envoyer mon profil pour validation'}</button></form>`;
  $('#ph').onchange = async ev => {
    try { photo = await uploadPhoto('mac-photos', ev.target.files[0]); $('#phv').innerHTML = `<img src="${e(photo)}" style="width:90px;height:90px;object-fit:cover;border-radius:50%">`; }
    catch (err) { toast(errMsg(err), 'err'); }
  };
  $('#tf').onsubmit = async ev => {
    ev.preventDefault();
    const b = $('#tf button'); busy(b, true);
    const f = formData(ev.target);
    const arr = k => [].concat(f[k] || []);
    if (!arr('subjects').length || !arr('levels').length) { busy(b, false); return toast('Choisissez au moins une matière et un niveau', 'warn'); }
    const row = { id: state.user.id, display_name: f.display_name, whatsapp: f.whatsapp, headline: f.headline, bio: f.bio, photo_url: photo || '',
      subjects: arr('subjects'), levels: arr('levels'), districts: arr('districts'), languages: arr('languages'),
      teach_mode: f.teach_mode, hourly_rate_djf: Number(f.hourly_rate_djf), experience_years: Number(f.experience_years || 0) };
    const { error } = await sb.from('mac_tutors').upsert(row);
    busy(b, false);
    if (error) return toast(errMsg(error), 'err');
    toast(t ? 'Profil enregistré' : 'Profil envoyé ! Validation sous 24–48 h, puis 1 mois offert.');
    go('/prof?t=' + (t ? 'profil' : 'req'));
  };
});

// ---------- Payments ----------
route('/pay', async (view, _, q) => {
  if (!state.user) return go('/login?prof=1');
  const prod = PRODUCTS[q.product];
  if (!prod) return go('/prof');
  paymentPage(view, { table: 'mac_payments', product: q.product, label: prod.label, amount: prod.price, back: '#/prof?t=pay' });
});

// ---------- Admin ----------
route('/admin', async (view, _, q) => {
  if (!state.profile?.is_admin) { view.innerHTML = '<div class="card">Accès réservé.</div>'; return; }
  const t = q.t || 'tut';
  view.innerHTML = `<div class="card"><h2>Administration</h2><div class="tabs">
    <a class="tab ${t === 'tut' ? 'active' : ''}" href="#/admin?t=tut">Professeurs</a>
    <a class="tab ${t === 'pay' ? 'active' : ''}" href="#/admin?t=pay">Paiements</a></div><div id="adm"></div></div>`;
  const el = $('#adm');
  if (t === 'pay') return adminPayments(el, 'mac_payments', Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, v.label])));
  const { data, error } = await sb.from('mac_tutors').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Professeur</th><th>Matières</th><th>Statut</th><th>Abonné jusqu'au</th><th>Actions</th></tr></thead><tbody>
    ${data.map(x => `<tr><td><b>${e(x.display_name)}</b><br><span class="small">${e(x.whatsapp)}</span></td><td class="small">${e(x.subjects.join(', '))}<br>${e(x.levels.join(', '))}</td>
      <td><span class="badge ${x.status}">${x.status}</span> ${x.verified ? '✔' : ''}</td><td>${fmtDate(x.subscribed_until)}</td>
      <td style="white-space:nowrap">${x.status !== 'active' ? `<button class="btn sm primary" data-up="${x.id}" data-f='{"status":"active"}'>Approuver</button>` : `<button class="btn sm ghost" data-up="${x.id}" data-f='{"status":"suspended"}'>Suspendre</button>`}
      <button class="btn sm ghost" data-up="${x.id}" data-f='{"verified":${!x.verified}}'>${x.verified ? 'Retirer ✔' : 'Diplômes ✔'}</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-up]', el).forEach(b => b.onclick = async () => {
    const { error } = await sb.from('mac_tutors').update(JSON.parse(b.dataset.f)).eq('id', b.dataset.up);
    error ? toast(errMsg(error), 'err') : render();
  });
});

sb.auth.onAuthStateChange(async ev => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') await refresh(); });
await refresh();
startRouter();

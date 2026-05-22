/**
 * translations.ts — UI string catalog for all four product surfaces.
 *
 * Convention: dotted key paths grouped by component / surface. IT is the
 * source of truth (matches the original copy ratified by the founder);
 * EN/DE/FR are translations. When the active language code is missing a
 * key, `t()` in LanguageContext falls back to IT — keeping the surface
 * usable rather than printing a key on screen.
 *
 * Adding a new string:
 *   1. Add the IT entry first (this is the canonical source).
 *   2. Translate to EN/DE/FR — keep tone equally professional.
 *   3. Add `t('your.key')` in the component.
 *
 * Notes:
 *   - "AI" is the brand-neutral term (replacing "Claude") across all four.
 *   - Header brand label + tagline are NOT here — they live in
 *     `LanguageContext.tsx` (BRAND_BY_LANG / TAGLINE_BY_LANG) because they
 *     are language-identity strings, not generic UI copy.
 */

export type Language = 'it' | 'en' | 'de' | 'fr'

type Catalog = Record<string, string>

const it: Catalog = {
  // ────────────────────────── Header / nav ──────────────────────────
  'nav.work': 'Strumento',
  'nav.dashboard': 'I miei mapping',
  'nav.login': 'Accedi',
  'nav.signup': 'Crea account',
  'nav.logout': 'Esci',
  'nav.lockedHint': '(bloccato)',
  'nav.lockedTitle': 'Master key non in memoria: serve riaprire la password per cifrare/decifrare i mapping.',
  'lang.label': 'Lingua documento',
  'lang.ui.label': 'Lingua interfaccia',
  'lang.doc.label': 'Lingua documento',
  'lang.doc.option.it': 'Italiano',
  'lang.doc.option.en': 'Inglese',
  'lang.doc.option.de': 'Tedesco',
  'lang.doc.option.fr': 'Francese',

  // ────────────────────────── Active-mapping banner ──────────────────────────
  'banner.active.label': 'Mapping attivo:',
  'banner.active.dirty': '· modifiche non salvate',
  'banner.active.hint': 'I prossimi documenti che trascini saranno pseudonimizzati con gli stessi pseudonimi (continuità di causa).',
  'banner.active.delete': '✕ Elimina mapping',
  'banner.active.deleteTitle': 'Elimina il mapping attivo e ricomincia da zero',
  'banner.active.deleteAria': 'Elimina mapping attivo',
  'banner.active.deleteConfirm': 'Eliminare il mapping attivo? Le sostituzioni di questo caso verranno dimenticate e i prossimi documenti ripartiranno da zero. Le modifiche non salvate andranno perse.',

  // ────────────────────────── App shell / footer ──────────────────────────
  'app.loadingSession': 'Caricamento sessione…',
  'app.footer.tagline': 'Pseudonimizzazione e recoding in locale, senza upload del documento originale.',
  'app.footer.privacy': 'Privacy',
  'app.footer.build': 'build',

  // ────────────────────────── Pseudonymize panel ──────────────────────────
  'pseudo.heading': 'Pseudonimizza',
  'pseudo.button.pseudonimize': 'Pseudonimizza',
  'pseudo.button.extend': 'Estendi mapping',
  'pseudo.button.loading': 'Caricamento modello AI…',
  'pseudo.button.running': 'Riconoscimento entità in corso…',
  'pseudo.button.save': 'Salva mapping',
  'pseudo.toggle.pseudonimo': 'Pseudonimizzato',
  'pseudo.toggle.originale': 'Originale',
  'pseudo.toggle.places': 'Sostituisci anche luoghi, organizzazioni e tribunali',
  'pseudo.button.newDocument': '↻ Nuovo documento',
  'pseudo.button.newDocumentTitle': 'Carica un nuovo documento (sostituisce quello attuale)',
  'pseudo.button.copy': 'Copia',
  'pseudo.button.copied': 'Copiato ✓',
  'pseudo.button.openRecode': 'Recode risposta AI →',
  'pseudo.button.openRecodeReady': 'Apri il pannello Recode per riportare la risposta dell’AI',
  'pseudo.button.openRecodeEmpty': 'Pseudonimizza un documento prima di aprire il recode.',
  'pseudo.status.running': 'Riconoscimento entità in corso…',
  'pseudo.error.nerUnavailable': 'Modello NER non disponibile. La pseudonimizzazione resta attiva per CF, IBAN, email e altri identificatori strutturati.',
  'pseudo.error.nerBackend': 'Errore tecnico nel caricamento del runtime NER. La pseudonimizzazione regex resta attiva (CF, IBAN, email, ecc.).',
  'pseudo.partial.title': 'Riconoscimento entità incompleto',
  'pseudo.partial.singular': 'sezione',
  'pseudo.partial.plural': 'sezioni',
  'pseudo.partial.body': 'del documento. Pseudonimizzazione completata su regex e parti riconosciute.',
  'pseudo.partial.manualHint': 'Per i nomi rimasti in chiaro: selezionali col mouse direttamente nel testo qui sotto e scegli la categoria dal menu che appare — la sostituzione si applica a tutte le occorrenze del documento.',
  'pseudo.partial.skippedSections': 'Sezioni saltate (offset caratteri)',
  'pseudo.dropzone.hint': 'Trascina un file qui sopra o incolla il testo per cominciare. Le entità rilevate appariranno evidenziate direttamente nel documento.',

  // ────────────────────────── Recode panel ──────────────────────────
  'recode.title': 'Recode',
  'recode.subtitle': 'Incolla qui la risposta dell’AI (che contiene gli pseudonimi). I pseudonimi vengono sostituiti con i valori originali, in locale, via reverse-mapping della tabella di sostituzione.',
  'recode.closeAria': 'Chiudi pannello recode',
  'recode.mappingBadge.singular': 'sostituzione attiva',
  'recode.mappingBadge.plural': 'sostituzioni attive',
  'recode.noMapping.title': 'Nessuna mappa di sostituzione attiva.',
  'recode.noMapping.body': 'Pseudonimizza prima un documento (bottone «Pseudonimizza» a sinistra) per popolare la tabella di reverse-mapping. Una volta fatto, potrai incollare qui la risposta dell’AI e vedere i nomi originali apparire automaticamente sotto.',
  'recode.field.input': 'Risposta dell’AI (con pseudonimi)',
  'recode.field.inputPlaceholder': 'Incolla qui la risposta dell’AI…',
  'recode.field.output': 'Risposta recodata',
  'recode.field.outputPlaceholder': 'Il testo recodato apparirà qui.',
  'recode.button.recodeNow': 'Recode adesso',
  'recode.button.recodeNowTitleNoMapping': 'Serve una mappa di sostituzione attiva (pseudonimizza prima un documento).',
  'recode.button.recodeNowTitleEmpty': 'Incolla la risposta dell’AI qui sopra.',
  'recode.button.recodeNowTitleReady': 'Esegui subito il reverse-mapping (succede anche automaticamente dopo qualche istante).',

  // ────────────────────────── Document view ──────────────────────────
  'docview.empty': 'Trascina un file qui sopra o incolla il testo per cominciare. Le entità rilevate appariranno evidenziate direttamente nel documento.',
  'docview.manualHint.prefix': 'Se vedi un nome o un dato sensibile',
  'docview.manualHint.inChiaro': 'in chiaro',
  'docview.manualHint.suffix': 'nel testo qui sotto (il modello NER non l’ha riconosciuto), selezionalo e scegli la categoria dal menu che appare. Basta selezionarlo una volta — la sostituzione si applica a tutte le occorrenze nel documento.',
  'docview.menu.anonimize': 'Anonimizza come',
  'docview.menu.persona': 'Persona',
  'docview.menu.luogo': 'Luogo',
  'docview.menu.organizzazione': 'Organizzazione',
  'docview.menu.tribunale': 'Tribunale',
  'docview.menu.altro': 'Altro',
  'docview.menu.skip': 'Salta',
  'docview.menu.menuMore': '…',
  'docview.menu.menuHide': 'Nascondi',
  'docview.menu.copyOriginal': 'Copia testo originale',
  'docview.menu.lookup': 'Cerca su web',
}

const en: Catalog = {
  // ────────────────────────── Header / nav ──────────────────────────
  'nav.work': 'Tool',
  'nav.dashboard': 'My mappings',
  'nav.login': 'Sign in',
  'nav.signup': 'Create account',
  'nav.logout': 'Sign out',
  'nav.lockedHint': '(locked)',
  'nav.lockedTitle': 'Master key not in memory: re-enter your password to encrypt/decrypt mappings.',
  'lang.label': 'Document language',
  'lang.ui.label': 'Interface language',
  'lang.doc.label': 'Document language',
  'lang.doc.option.it': 'Italian',
  'lang.doc.option.en': 'English',
  'lang.doc.option.de': 'German',
  'lang.doc.option.fr': 'French',

  // ────────────────────────── Active-mapping banner ──────────────────────────
  'banner.active.label': 'Active mapping:',
  'banner.active.dirty': '· unsaved changes',
  'banner.active.hint': 'The next documents you drop will be pseudonymized using the same pseudonyms (case continuity).',
  'banner.active.delete': '✕ Delete mapping',
  'banner.active.deleteTitle': 'Delete the active mapping and start fresh',
  'banner.active.deleteAria': 'Delete active mapping',
  'banner.active.deleteConfirm': 'Delete the active mapping? The substitutions for this case will be forgotten and the next documents will start over. Unsaved changes will be lost.',

  // ────────────────────────── App shell / footer ──────────────────────────
  'app.loadingSession': 'Loading session…',
  'app.footer.tagline': 'Local pseudonymization and recoding — your original document is never uploaded.',
  'app.footer.privacy': 'Privacy',
  'app.footer.build': 'build',

  // ────────────────────────── Pseudonymize panel ──────────────────────────
  'pseudo.heading': 'Pseudonymize',
  'pseudo.button.pseudonimize': 'Pseudonymize',
  'pseudo.button.extend': 'Extend mapping',
  'pseudo.button.loading': 'Loading AI model…',
  'pseudo.button.running': 'Recognizing entities…',
  'pseudo.button.save': 'Save mapping',
  'pseudo.toggle.pseudonimo': 'Pseudonymized',
  'pseudo.toggle.originale': 'Original',
  'pseudo.toggle.places': 'Also replace places, organizations and courts',
  'pseudo.button.newDocument': '↻ New document',
  'pseudo.button.newDocumentTitle': 'Load a new document (replaces the current one)',
  'pseudo.button.copy': 'Copy',
  'pseudo.button.copied': 'Copied ✓',
  'pseudo.button.openRecode': 'Recode AI response →',
  'pseudo.button.openRecodeReady': 'Open the Recode panel to map back the AI response',
  'pseudo.button.openRecodeEmpty': 'Pseudonymize a document before opening recode.',
  'pseudo.status.running': 'Recognizing entities…',
  'pseudo.error.nerUnavailable': 'NER model unavailable. Pseudonymization is still active for tax IDs, IBANs, emails and other structured identifiers.',
  'pseudo.error.nerBackend': 'Technical error loading the NER runtime. Regex-based pseudonymization is still active (tax IDs, IBANs, emails, etc.).',
  'pseudo.partial.title': 'Incomplete entity recognition',
  'pseudo.partial.singular': 'section',
  'pseudo.partial.plural': 'sections',
  'pseudo.partial.body': 'of the document. Pseudonymization completed on regex and recognized parts.',
  'pseudo.partial.manualHint': 'For names left in plain text: select them with the mouse directly in the text below and choose a category from the menu that appears — the substitution applies to every occurrence in the document.',
  'pseudo.partial.skippedSections': 'Skipped sections (character offsets)',
  'pseudo.dropzone.hint': 'Drop a file here or paste the text to start. Detected entities will appear highlighted directly in the document.',

  // ────────────────────────── Recode panel ──────────────────────────
  'recode.title': 'Recode',
  'recode.subtitle': 'Paste the AI response here (it contains the pseudonyms). Pseudonyms are replaced with the original values locally, via reverse mapping of the substitution table.',
  'recode.closeAria': 'Close recode panel',
  'recode.mappingBadge.singular': 'active substitution',
  'recode.mappingBadge.plural': 'active substitutions',
  'recode.noMapping.title': 'No active substitution map.',
  'recode.noMapping.body': 'Pseudonymize a document first («Pseudonymize» button on the left) to populate the reverse-mapping table. Once done, you can paste the AI response here and see the original names appear automatically below.',
  'recode.field.input': 'AI response (with pseudonyms)',
  'recode.field.inputPlaceholder': 'Paste the AI response here…',
  'recode.field.output': 'Recoded response',
  'recode.field.outputPlaceholder': 'The recoded text will appear here.',
  'recode.button.recodeNow': 'Recode now',
  'recode.button.recodeNowTitleNoMapping': 'An active substitution map is needed (pseudonymize a document first).',
  'recode.button.recodeNowTitleEmpty': 'Paste the AI response above.',
  'recode.button.recodeNowTitleReady': 'Run the reverse mapping immediately (it also happens automatically after a moment).',

  // ────────────────────────── Document view ──────────────────────────
  'docview.empty': 'Drop a file here or paste the text to start. Detected entities will appear highlighted directly in the document.',
  'docview.manualHint.prefix': 'If you see a name or sensitive data',
  'docview.manualHint.inChiaro': 'in plain text',
  'docview.manualHint.suffix': 'in the text below (the NER model did not recognize it), select it and choose a category from the menu that appears. One selection is enough — the substitution applies to every occurrence in the document.',
  'docview.menu.anonimize': 'Anonymize as',
  'docview.menu.persona': 'Person',
  'docview.menu.luogo': 'Location',
  'docview.menu.organizzazione': 'Organization',
  'docview.menu.tribunale': 'Court',
  'docview.menu.altro': 'Other',
  'docview.menu.skip': 'Skip',
  'docview.menu.menuMore': '…',
  'docview.menu.menuHide': 'Hide',
  'docview.menu.copyOriginal': 'Copy original text',
  'docview.menu.lookup': 'Look up on the web',
}

const de: Catalog = {
  // ────────────────────────── Header / nav ──────────────────────────
  'nav.work': 'Werkzeug',
  'nav.dashboard': 'Meine Mappings',
  'nav.login': 'Anmelden',
  'nav.signup': 'Konto erstellen',
  'nav.logout': 'Abmelden',
  'nav.lockedHint': '(gesperrt)',
  'nav.lockedTitle': 'Hauptschlüssel nicht im Speicher: Passwort erneut eingeben, um Mappings zu ver-/entschlüsseln.',
  'lang.label': 'Dokumentsprache',
  'lang.ui.label': 'Sprache der Oberfläche',
  'lang.doc.label': 'Dokumentsprache',
  'lang.doc.option.it': 'Italienisch',
  'lang.doc.option.en': 'Englisch',
  'lang.doc.option.de': 'Deutsch',
  'lang.doc.option.fr': 'Französisch',

  // ────────────────────────── Active-mapping banner ──────────────────────────
  'banner.active.label': 'Aktives Mapping:',
  'banner.active.dirty': '· nicht gespeicherte Änderungen',
  'banner.active.hint': 'Die nächsten Dokumente, die Sie ablegen, werden mit denselben Pseudonymen pseudonymisiert (Fall-Kontinuität).',
  'banner.active.delete': '✕ Mapping löschen',
  'banner.active.deleteTitle': 'Aktives Mapping löschen und neu starten',
  'banner.active.deleteAria': 'Aktives Mapping löschen',
  'banner.active.deleteConfirm': 'Aktives Mapping löschen? Die Ersetzungen dieses Falls werden vergessen und die nächsten Dokumente beginnen von vorne. Nicht gespeicherte Änderungen gehen verloren.',

  // ────────────────────────── App shell / footer ──────────────────────────
  'app.loadingSession': 'Sitzung wird geladen…',
  'app.footer.tagline': 'Lokale Pseudonymisierung und Recoding — Ihr Originaldokument wird nie hochgeladen.',
  'app.footer.privacy': 'Datenschutz',
  'app.footer.build': 'Build',

  // ────────────────────────── Pseudonymize panel ──────────────────────────
  'pseudo.heading': 'Pseudonymisieren',
  'pseudo.button.pseudonimize': 'Pseudonymisieren',
  'pseudo.button.extend': 'Mapping erweitern',
  'pseudo.button.loading': 'KI-Modell wird geladen…',
  'pseudo.button.running': 'Entitäten werden erkannt…',
  'pseudo.button.save': 'Mapping speichern',
  'pseudo.toggle.pseudonimo': 'Pseudonymisiert',
  'pseudo.toggle.originale': 'Original',
  'pseudo.toggle.places': 'Auch Orte, Organisationen und Gerichte ersetzen',
  'pseudo.button.newDocument': '↻ Neues Dokument',
  'pseudo.button.newDocumentTitle': 'Neues Dokument laden (ersetzt das aktuelle)',
  'pseudo.button.copy': 'Kopieren',
  'pseudo.button.copied': 'Kopiert ✓',
  'pseudo.button.openRecode': 'KI-Antwort recoden →',
  'pseudo.button.openRecodeReady': 'Recode-Panel öffnen, um die KI-Antwort zurückzubilden',
  'pseudo.button.openRecodeEmpty': 'Pseudonymisieren Sie ein Dokument, bevor Sie Recode öffnen.',
  'pseudo.status.running': 'Entitäten werden erkannt…',
  'pseudo.error.nerUnavailable': 'NER-Modell nicht verfügbar. Die Pseudonymisierung bleibt für Steuer-IDs, IBANs, E-Mails und andere strukturierte Kennungen aktiv.',
  'pseudo.error.nerBackend': 'Technischer Fehler beim Laden der NER-Laufzeitumgebung. Regex-basierte Pseudonymisierung bleibt aktiv (Steuer-IDs, IBANs, E-Mails usw.).',
  'pseudo.partial.title': 'Unvollständige Entitätserkennung',
  'pseudo.partial.singular': 'Abschnitt',
  'pseudo.partial.plural': 'Abschnitte',
  'pseudo.partial.body': 'des Dokuments. Pseudonymisierung über Regex und erkannte Teile abgeschlossen.',
  'pseudo.partial.manualHint': 'Für Namen im Klartext: Markieren Sie sie mit der Maus direkt im Text unten und wählen Sie eine Kategorie aus dem Menü, das erscheint — die Ersetzung gilt für alle Vorkommen im Dokument.',
  'pseudo.partial.skippedSections': 'Übersprungene Abschnitte (Zeichenoffsets)',
  'pseudo.dropzone.hint': 'Datei hierher ziehen oder Text einfügen, um zu starten. Erkannte Entitäten erscheinen direkt im Dokument hervorgehoben.',

  // ────────────────────────── Recode panel ──────────────────────────
  'recode.title': 'Recode',
  'recode.subtitle': 'Fügen Sie die KI-Antwort hier ein (sie enthält die Pseudonyme). Die Pseudonyme werden lokal durch die Originalwerte ersetzt, per Rückzuordnung der Substitutionstabelle.',
  'recode.closeAria': 'Recode-Panel schließen',
  'recode.mappingBadge.singular': 'aktive Ersetzung',
  'recode.mappingBadge.plural': 'aktive Ersetzungen',
  'recode.noMapping.title': 'Keine aktive Ersetzungskarte.',
  'recode.noMapping.body': 'Pseudonymisieren Sie zuerst ein Dokument (Schaltfläche «Pseudonymisieren» links), um die Rückzuordnungstabelle zu füllen. Danach können Sie die KI-Antwort hier einfügen und sehen die Originalnamen automatisch darunter erscheinen.',
  'recode.field.input': 'KI-Antwort (mit Pseudonymen)',
  'recode.field.inputPlaceholder': 'KI-Antwort hier einfügen…',
  'recode.field.output': 'Recodete Antwort',
  'recode.field.outputPlaceholder': 'Der recodete Text erscheint hier.',
  'recode.button.recodeNow': 'Jetzt recoden',
  'recode.button.recodeNowTitleNoMapping': 'Eine aktive Ersetzungskarte wird benötigt (pseudonymisieren Sie zuerst ein Dokument).',
  'recode.button.recodeNowTitleEmpty': 'KI-Antwort oben einfügen.',
  'recode.button.recodeNowTitleReady': 'Rückzuordnung sofort ausführen (geschieht auch automatisch nach einem Moment).',

  // ────────────────────────── Document view ──────────────────────────
  'docview.empty': 'Datei hierher ziehen oder Text einfügen, um zu starten. Erkannte Entitäten erscheinen direkt im Dokument hervorgehoben.',
  'docview.manualHint.prefix': 'Wenn Sie einen Namen oder sensible Daten',
  'docview.manualHint.inChiaro': 'im Klartext',
  'docview.manualHint.suffix': 'im Text unten sehen (das NER-Modell hat sie nicht erkannt), markieren Sie sie und wählen Sie eine Kategorie aus dem Menü, das erscheint. Eine Auswahl genügt — die Ersetzung gilt für alle Vorkommen im Dokument.',
  'docview.menu.anonimize': 'Anonymisieren als',
  'docview.menu.persona': 'Person',
  'docview.menu.luogo': 'Ort',
  'docview.menu.organizzazione': 'Organisation',
  'docview.menu.tribunale': 'Gericht',
  'docview.menu.altro': 'Andere',
  'docview.menu.skip': 'Überspringen',
  'docview.menu.menuMore': '…',
  'docview.menu.menuHide': 'Ausblenden',
  'docview.menu.copyOriginal': 'Originaltext kopieren',
  'docview.menu.lookup': 'Im Web suchen',
}

const fr: Catalog = {
  // ────────────────────────── Header / nav ──────────────────────────
  'nav.work': 'Outil',
  'nav.dashboard': 'Mes mappings',
  'nav.login': 'Se connecter',
  'nav.signup': 'Créer un compte',
  'nav.logout': 'Se déconnecter',
  'nav.lockedHint': '(verrouillé)',
  'nav.lockedTitle': 'Clé principale absente de la mémoire : ressaisissez votre mot de passe pour chiffrer/déchiffrer les mappings.',
  'lang.label': 'Langue du document',
  'lang.ui.label': 'Langue de l’interface',
  'lang.doc.label': 'Langue du document',
  'lang.doc.option.it': 'Italien',
  'lang.doc.option.en': 'Anglais',
  'lang.doc.option.de': 'Allemand',
  'lang.doc.option.fr': 'Français',

  // ────────────────────────── Active-mapping banner ──────────────────────────
  'banner.active.label': 'Mapping actif :',
  'banner.active.dirty': '· modifications non enregistrées',
  'banner.active.hint': 'Les prochains documents que vous déposerez seront pseudonymisés avec les mêmes pseudonymes (continuité du dossier).',
  'banner.active.delete': '✕ Supprimer le mapping',
  'banner.active.deleteTitle': 'Supprimer le mapping actif et repartir de zéro',
  'banner.active.deleteAria': 'Supprimer le mapping actif',
  'banner.active.deleteConfirm': 'Supprimer le mapping actif ? Les substitutions de ce dossier seront oubliées et les prochains documents repartiront de zéro. Les modifications non enregistrées seront perdues.',

  // ────────────────────────── App shell / footer ──────────────────────────
  'app.loadingSession': 'Chargement de la session…',
  'app.footer.tagline': 'Pseudonymisation et recodage en local — votre document original n’est jamais téléversé.',
  'app.footer.privacy': 'Confidentialité',
  'app.footer.build': 'build',

  // ────────────────────────── Pseudonymize panel ──────────────────────────
  'pseudo.heading': 'Pseudonymiser',
  'pseudo.button.pseudonimize': 'Pseudonymiser',
  'pseudo.button.extend': 'Étendre le mapping',
  'pseudo.button.loading': 'Chargement du modèle IA…',
  'pseudo.button.running': 'Reconnaissance des entités en cours…',
  'pseudo.button.save': 'Enregistrer le mapping',
  'pseudo.toggle.pseudonimo': 'Pseudonymisé',
  'pseudo.toggle.originale': 'Original',
  'pseudo.toggle.places': 'Remplacer aussi lieux, organisations et tribunaux',
  'pseudo.button.newDocument': '↻ Nouveau document',
  'pseudo.button.newDocumentTitle': 'Charger un nouveau document (remplace l’actuel)',
  'pseudo.button.copy': 'Copier',
  'pseudo.button.copied': 'Copié ✓',
  'pseudo.button.openRecode': 'Recoder la réponse IA →',
  'pseudo.button.openRecodeReady': 'Ouvrir le panneau Recode pour reconstituer la réponse de l’IA',
  'pseudo.button.openRecodeEmpty': 'Pseudonymisez un document avant d’ouvrir le recode.',
  'pseudo.status.running': 'Reconnaissance des entités en cours…',
  'pseudo.error.nerUnavailable': 'Modèle NER indisponible. La pseudonymisation reste active pour identifiants fiscaux, IBAN, emails et autres identifiants structurés.',
  'pseudo.error.nerBackend': 'Erreur technique au chargement du runtime NER. La pseudonymisation par regex reste active (identifiants fiscaux, IBAN, emails, etc.).',
  'pseudo.partial.title': 'Reconnaissance d’entités incomplète',
  'pseudo.partial.singular': 'section',
  'pseudo.partial.plural': 'sections',
  'pseudo.partial.body': 'du document. Pseudonymisation effectuée sur regex et parties reconnues.',
  'pseudo.partial.manualHint': 'Pour les noms restés en clair : sélectionnez-les à la souris directement dans le texte ci-dessous et choisissez une catégorie dans le menu qui apparaît — la substitution s’applique à toutes les occurrences du document.',
  'pseudo.partial.skippedSections': 'Sections ignorées (offsets de caractères)',
  'pseudo.dropzone.hint': 'Déposez un fichier ici ou collez le texte pour commencer. Les entités détectées apparaîtront surlignées directement dans le document.',

  // ────────────────────────── Recode panel ──────────────────────────
  'recode.title': 'Recode',
  'recode.subtitle': 'Collez ici la réponse de l’IA (qui contient les pseudonymes). Les pseudonymes sont remplacés par les valeurs originales en local, via reverse-mapping de la table de substitution.',
  'recode.closeAria': 'Fermer le panneau recode',
  'recode.mappingBadge.singular': 'substitution active',
  'recode.mappingBadge.plural': 'substitutions actives',
  'recode.noMapping.title': 'Aucune table de substitution active.',
  'recode.noMapping.body': 'Pseudonymisez d’abord un document (bouton «Pseudonymiser» à gauche) pour remplir la table de reverse-mapping. Une fois fait, vous pourrez coller ici la réponse de l’IA et voir les noms originaux apparaître automatiquement en dessous.',
  'recode.field.input': 'Réponse de l’IA (avec pseudonymes)',
  'recode.field.inputPlaceholder': 'Collez ici la réponse de l’IA…',
  'recode.field.output': 'Réponse recodée',
  'recode.field.outputPlaceholder': 'Le texte recodé apparaîtra ici.',
  'recode.button.recodeNow': 'Recoder maintenant',
  'recode.button.recodeNowTitleNoMapping': 'Une table de substitution active est nécessaire (pseudonymisez d’abord un document).',
  'recode.button.recodeNowTitleEmpty': 'Collez la réponse de l’IA ci-dessus.',
  'recode.button.recodeNowTitleReady': 'Exécuter le reverse-mapping immédiatement (cela se produit aussi automatiquement après un instant).',

  // ────────────────────────── Document view ──────────────────────────
  'docview.empty': 'Déposez un fichier ici ou collez le texte pour commencer. Les entités détectées apparaîtront surlignées directement dans le document.',
  'docview.manualHint.prefix': 'Si vous voyez un nom ou une donnée sensible',
  'docview.manualHint.inChiaro': 'en clair',
  'docview.manualHint.suffix': 'dans le texte ci-dessous (le modèle NER ne l’a pas reconnu), sélectionnez-le et choisissez une catégorie dans le menu qui apparaît. Une seule sélection suffit — la substitution s’applique à toutes les occurrences du document.',
  'docview.menu.anonimize': 'Anonymiser en tant que',
  'docview.menu.persona': 'Personne',
  'docview.menu.luogo': 'Lieu',
  'docview.menu.organizzazione': 'Organisation',
  'docview.menu.tribunale': 'Tribunal',
  'docview.menu.altro': 'Autre',
  'docview.menu.skip': 'Ignorer',
  'docview.menu.menuMore': '…',
  'docview.menu.menuHide': 'Masquer',
  'docview.menu.copyOriginal': 'Copier le texte original',
  'docview.menu.lookup': 'Rechercher sur le web',
}

export const TRANSLATIONS: Record<Language, Catalog> = { it, en, de, fr }

/**
 * Resolve a key against the language catalog. Falls back to Italian
 * (canonical source) when a translation is missing, then to the key
 * itself as last resort so the UI never renders an empty string.
 */
export function translate(language: Language, key: string): string {
  const langCat = TRANSLATIONS[language] ?? TRANSLATIONS.it
  return langCat[key] ?? TRANSLATIONS.it[key] ?? key
}

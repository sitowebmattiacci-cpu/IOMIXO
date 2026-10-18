import { pick, type LegalBuilders, type LegalDoc, type LegalVars } from './types'

type Sec = { title: string; blocks: LegalDoc['sections'][number]['blocks'] }
/** Sections are written without numbers: the two portals have a different set, numbering follows the order. */
const number = (secs: Sec[]): Sec[] => secs.map((s, i) => ({ ...s, title: `${i + 1}. ${s.title}` }))

const en: LegalBuilders['en'] = (v) => {
  const m = v.miolove
  const secs: Sec[] = [
    { title: 'The service', blocks: m ? [{ p: 'A couple creates an account and an album for their wedding or event, and shares a QR code or link with the guests. Guests open it from their phone, without installing an app, and can upload photos through the Live Booth and, where enabled, send dedications or messages. The photos can be shown in a live slideshow on a TV or projector and are collected in the digital album of the event.' }] : [
      { p: 'IOMIXO lets a host (for example a DJ or an event organizer) create live events in Party or Wedding mode and share them with guests through a QR code or link. Depending on the plan and the settings chosen by the host, guests can send music requests, dedications and messages, answer polls, play games and upload photos through the Live Booth, and the host can show content on a TV or projector with Screen Mode. Guests do not need to install an app.' },
      { p: 'IOMIXO does not stream, distribute or license music. Music requests are text messages sent to the host.' },
    ] },
    { title: 'Eligibility and account', blocks: [{ ul: [
      m ? 'You must be at least 16 years old (or the age of digital consent in your country) to create an account.' : 'You must be at least 16 years old (or the age of digital consent in your country) to use IOMIXO.',
      'You are responsible for keeping your credentials secure and for all activity under your account.',
      'You must provide accurate account and billing information and keep it up to date.',
    ] }] },
    m ? { title: 'Albums, photos and your responsibility', blocks: [
      { p: '**Whoever takes a photo keeps the rights in it.** By uploading a photo or message to an album, the uploader grants MIOLOVE a limited, worldwide, non-exclusive, royalty-free license to host, process and display it for the sole purpose of operating the service: showing it in the album and in the slideshow of the event, and making it available to the owner of the album.' },
      { p: '**You are solely responsible for the content you upload or publish, and for the album you create.** The owner of an album is responsible for informing the guests about the collection of photos and for the permissions that the law requires when photos show people. Guests are responsible for the photos they upload and must hold the rights to them.' },
      { p: 'The owner of an album can remove photos and messages from it. We may also remove content, at our reasonable discretion or on a justified report.' },
    ] } : { title: 'Content and your responsibility', blocks: [
      { p: '**You retain ownership of the content you submit**, such as requests, dedications, answers and photos. By submitting content you grant IOMIXO a limited, worldwide, non-exclusive, royalty-free license to host, process and display it for the sole purpose of operating the service, including showing it to the participants of the event, on Screen Mode and in the event’s photo collection.' },
      { p: '**You are solely responsible for the content you submit or publish through your events**, and for having all rights, licenses and consents needed for it. If photos show other people, you are responsible for having the permission and giving the notices that the law requires. Hosts are responsible for the content shared by guests at their events and can use the moderation tools available in the service.' },
      { p: 'Any music you play at an event, and any licence or fee required to play it publicly, is your responsibility and is outside the service.' },
    ] },
    { title: 'Acceptable use', blocks: [
      { p: 'You agree not to:' },
      { ul: m ? [
        'Upload or publish unlawful, offensive, hateful, defamatory or sexually explicit content, or content that harms minors.',
        'Upload images you do not have the right to use, or that violate the privacy or image rights of others.',
        'Upload malware or interfere with the security or operation of the service.',
        'Scrape or abuse the service or its limits.',
        'Share accounts or create accounts to evade a suspension.',
      ] : [
        'Submit or publish unlawful, offensive, hateful, defamatory or sexually explicit content, or content that harms minors.',
        'Infringe copyright, trademark, publicity or privacy rights of others.',
        'Upload malware or interfere with the security or operation of the service.',
        'Reverse engineer, scrape or abuse the service or its limits, or use it to send spam.',
        'Share accounts or create accounts to evade a suspension.',
      ] },
      { p: 'We may remove content and suspend or close accounts that we believe, in good faith, violate these Terms or the law.' },
    ] },
    m ? { title: 'Free and paid plans', blocks: [{ ul: [
      'MIOLOVE may offer a free plan, trial periods and paid plans or passes. What each one includes, its price and any trial conditions are shown in the service and at checkout.',
      'Payments are processed by Stripe. We do not see or store your full card details.',
      'You can cancel a subscription at any time from the billing page; cancellation takes effect at the end of the current billing period.',
      'Except where required by law, payments are non-refundable. VAT or other applicable taxes are added where required.',
    ] }] } : { title: 'Plans and billing', blocks: [{ ul: [
      'IOMIXO offers a free plan, paid monthly plans and a one-time 24-hour Event Pass. Features depend on the plan. Prices and what each plan includes are shown on the pricing page and at checkout.',
      'Payments are processed by Stripe. We do not see or store your full card details.',
      'Where a free trial is offered, its length and conditions are shown at checkout; a trial may end without a payment method being charged.',
      'You can cancel a subscription at any time from the billing portal; cancellation takes effect at the end of the current billing period.',
      'Except where required by law, payments are non-refundable. VAT or other applicable taxes are added where required.',
    ] }] },
    { title: 'Service availability', blocks: [{ p: `We aim for high availability but do not guarantee uninterrupted service. The service can be affected by maintenance, updates, outages, network conditions at the venue and the availability of third-party providers. ${m ? 'Keep your own copy of photos that are important to you.' : 'Do not rely on it as the only means to run a critical moment of your event.'}` }] },
    ...(m ? [{ title: 'Deleting content and closing your account', blocks: [{ p: 'You can delete your albums and moderate their content from your account. You may ask us to close your account at any time. How account data and content are handled after closure is described in the {{privacy:Privacy Policy}}; we may keep limited information where the law requires it (for example billing records).' }] }] : []),
    { title: `Intellectual property of ${v.short}`, blocks: [{ p: m ? 'The MIOLOVE ALBUM software, brand, interface and documentation are owned by MIOLOVE and protected by applicable intellectual property laws. These Terms give you only a limited right to use the service.' : 'The IOMIXO software, brand, interface and documentation are owned by IOMIXO and protected by applicable intellectual property laws. These Terms give you only a limited right to use the service according to your plan.' }] },
    { title: 'Reporting content', blocks: [{ p: m ? 'If you believe that a photo or message shown through MIOLOVE infringes your rights, your privacy or image rights, or is unlawful, write to {{mail}} identifying the content and explaining the issue. We will review it and, where appropriate, remove or disable access to it.' : 'If you believe that content shown through IOMIXO infringes your rights or is unlawful, write to {{mail}} identifying the content and explaining the issue. We will review it and, where appropriate, remove or disable access to it.' }] },
    { title: 'Disclaimers', blocks: [{ p: 'The service is provided **“as is” and “as available”** without warranties of any kind, to the extent permitted by law, including fitness for a particular purpose and uninterrupted or error-free operation.' }] },
    { title: 'Limitation of liability', blocks: [
      { p: `To the maximum extent permitted by law, ${v.short} will not be liable for indirect, incidental, special or consequential damages, or for lost profits, revenue, data or goodwill, arising from your use of the service. Our total liability for any claim relating to these Terms or the service is limited to the amount you paid to ${v.short} in the twelve (12) months before the event giving rise to the claim.` },
      { p: 'Nothing in these Terms limits liability that cannot be excluded under applicable law, including for fraud, gross negligence, or death or personal injury caused by negligence.' },
    ] },
    ...(m ? [] : [{ title: 'Indemnification', blocks: [{ p: 'To the extent permitted by law, you agree to hold IOMIXO harmless from claims, damages and expenses arising from content you or your guests submit through your events, from your violation of these Terms, or from your violation of third-party rights or applicable law.' }] }]),
    { title: m ? 'Suspension and termination' : 'Suspension and closure', blocks: [{ p: m ? 'We may suspend or close your account if you breach these Terms, abuse the service, or if required by law. We may keep limited information as required by law.' : 'You may stop using the service and ask us to close your account at any time. We may suspend or close your account if you breach these Terms, abuse the service, or if required by law. We may keep limited information as required by law (for example billing records).' }] },
    { title: 'Privacy', blocks: [{ p: m ? 'How we handle personal data, including guests’ photos, is described in our {{privacy:Privacy Policy}}.' : 'How we handle personal data is described in our {{privacy:Privacy Policy}}.' }] },
    { title: 'Changes to these Terms', blocks: [{ p: 'We may update these Terms from time to time. Material changes will be communicated by email or by a notice on the service at least 14 days before they take effect. Continued use after that date means you accept the changes.' }] },
    { title: 'Governing law and disputes', blocks: [{ p: 'These Terms are governed by the laws of Italy, without regard to conflict-of-law rules. The courts of Italy have exclusive jurisdiction over disputes arising from these Terms or the service, except where mandatory consumer protection law of your country of residence gives you the right to bring proceedings in your local courts.' }] },
    { title: 'Contact', blocks: [{ p: 'Questions about these Terms: {{mail}}.' }] },
  ]
  return {
    lead: `These Terms of Service (“Terms”) govern your access to and use of ${v.brand} (“${v.short}”, “we”, “us”), ${pick(v, ['an interactive platform for live events', 'a service that lets couples collect their wedding or event photos from guests in a digital album'])}. By creating an account or using the service you agree to these Terms. If you do not agree, do not use the service.`,
    sections: number(secs),
  }
}

const it: LegalBuilders['it'] = (v) => {
  const m = v.miolove
  const secs: Sec[] = [
    { title: 'Il servizio', blocks: m ? [{ p: 'Una coppia crea un account e un album per il proprio matrimonio o evento e condivide un codice QR o un link con gli ospiti. Gli ospiti lo aprono dal telefono, senza installare alcuna app, e possono caricare foto tramite il Live Booth e, dove abilitato, inviare dediche o messaggi. Le foto possono essere mostrate in una presentazione dal vivo su un televisore o proiettore e vengono raccolte nell’album digitale dell’evento.' }] : [
      { p: 'IOMIXO consente a un organizzatore (ad esempio un DJ o un organizzatore di eventi) di creare eventi dal vivo in modalità Party o Wedding e di condividerli con gli ospiti tramite un codice QR o un link. A seconda del piano e delle impostazioni scelte dall’organizzatore, gli ospiti possono inviare richieste musicali, dediche e messaggi, rispondere a sondaggi, partecipare a giochi e caricare foto tramite il Live Booth, e l’organizzatore può mostrare i contenuti su un televisore o proiettore con la Modalità Schermo. Gli ospiti non devono installare alcuna app.' },
      { p: 'IOMIXO non trasmette in streaming, non distribuisce né concede in licenza musica. Le richieste musicali sono messaggi di testo inviati all’organizzatore.' },
    ] },
    { title: 'Requisiti e account', blocks: [{ ul: [
      m ? 'Devi avere almeno 16 anni (o l’età del consenso digitale nel tuo Paese) per creare un account.' : 'Devi avere almeno 16 anni (o l’età del consenso digitale nel tuo Paese) per utilizzare IOMIXO.',
      'Sei responsabile della sicurezza delle tue credenziali e di tutte le attività svolte tramite il tuo account.',
      'Devi fornire informazioni accurate sull’account e sulla fatturazione e mantenerle aggiornate.',
    ] }] },
    m ? { title: 'Album, foto e tua responsabilità', blocks: [
      { p: '**Chi scatta una foto ne conserva i diritti.** Caricando una foto o un messaggio in un album, chi lo carica concede a MIOLOVE una licenza limitata, mondiale, non esclusiva e gratuita per ospitarlo, elaborarlo e mostrarlo al solo scopo di far funzionare il servizio: mostrarlo nell’album e nella presentazione dell’evento e renderlo disponibile al titolare dell’album.' },
      { p: '**Sei l’unico responsabile dei contenuti che carichi o pubblichi e dell’album che crei.** Il titolare di un album è responsabile di informare gli ospiti sulla raccolta delle foto e dei consensi che la legge richiede quando le foto ritraggono persone. Gli ospiti sono responsabili delle foto che caricano e devono detenerne i diritti.' },
      { p: 'Il titolare di un album può rimuovere foto e messaggi dall’album. Possiamo inoltre rimuovere contenuti, a nostra ragionevole discrezione o a seguito di una segnalazione motivata.' },
    ] } : { title: 'Contenuti e tua responsabilità', blocks: [
      { p: '**Mantieni la proprietà dei contenuti che invii**, come richieste, dediche, risposte e foto. Inviando contenuti concedi a IOMIXO una licenza limitata, mondiale, non esclusiva e gratuita per ospitarli, elaborarli e mostrarli al solo scopo di far funzionare il servizio, incluso mostrarli ai partecipanti all’evento, in Modalità Schermo e nella raccolta di foto dell’evento.' },
      { p: '**Sei l’unico responsabile dei contenuti che invii o pubblichi tramite i tuoi eventi**, e di disporre di tutti i diritti, le licenze e i consensi necessari. Se le foto ritraggono altre persone, sei responsabile di ottenere l’autorizzazione e di fornire le informative che la legge richiede. Gli organizzatori sono responsabili dei contenuti condivisi dagli ospiti ai loro eventi e possono utilizzare gli strumenti di moderazione disponibili nel servizio.' },
      { p: 'Qualsiasi musica riprodotta a un evento, e qualsiasi licenza o compenso necessario per la sua riproduzione in pubblico, è di tua responsabilità ed è al di fuori del servizio.' },
    ] },
    { title: 'Uso consentito', blocks: [
      { p: 'Ti impegni a non:' },
      { ul: m ? [
        'caricare o pubblicare contenuti illegali, offensivi, di odio, diffamatori o sessualmente espliciti, o contenuti che danneggiano i minori;',
        'caricare immagini che non hai il diritto di utilizzare o che violano la privacy o i diritti di immagine di altri;',
        'caricare malware o interferire con la sicurezza o il funzionamento del servizio;',
        'effettuare scraping o abusare del servizio o dei suoi limiti;',
        'condividere account o creare account per eludere una sospensione.',
      ] : [
        'inviare o pubblicare contenuti illegali, offensivi, di odio, diffamatori o sessualmente espliciti, o contenuti che danneggiano i minori;',
        'violare i diritti d’autore, i marchi, i diritti di immagine o la privacy di altri;',
        'caricare malware o interferire con la sicurezza o il funzionamento del servizio;',
        'effettuare reverse engineering, scraping o abusare del servizio o dei suoi limiti, o utilizzarlo per inviare spam;',
        'condividere account o creare account per eludere una sospensione.',
      ] },
      { p: 'Possiamo rimuovere contenuti e sospendere o chiudere gli account che riteniamo, in buona fede, violino i presenti Termini o la legge.' },
    ] },
    m ? { title: 'Piani gratuiti e a pagamento', blocks: [{ ul: [
      'MIOLOVE può offrire un piano gratuito, periodi di prova e piani o pass a pagamento. Ciò che ciascuno include, il relativo prezzo e le eventuali condizioni della prova sono indicati nel servizio e al momento del pagamento.',
      'I pagamenti sono elaborati da Stripe. Non vediamo né conserviamo i dati completi della tua carta.',
      'Puoi annullare un abbonamento in qualsiasi momento dalla pagina di fatturazione; l’annullamento ha effetto al termine del periodo di fatturazione in corso.',
      'Salvo quanto richiesto dalla legge, i pagamenti non sono rimborsabili. IVA e altre imposte applicabili sono aggiunte ove previsto.',
    ] }] } : { title: 'Piani e fatturazione', blocks: [{ ul: [
      'IOMIXO offre un piano gratuito, piani mensili a pagamento e un Event Pass una tantum di 24 ore. Le funzionalità dipendono dal piano. I prezzi e ciò che include ciascun piano sono indicati nella pagina dei prezzi e al momento del pagamento.',
      'I pagamenti sono elaborati da Stripe. Non vediamo né conserviamo i dati completi della tua carta.',
      'Quando viene offerta una prova gratuita, la sua durata e le sue condizioni sono indicate al momento del pagamento; una prova può terminare senza che venga addebitato alcun metodo di pagamento.',
      'Puoi annullare un abbonamento in qualsiasi momento dal portale di fatturazione; l’annullamento ha effetto al termine del periodo di fatturazione in corso.',
      'Salvo quanto richiesto dalla legge, i pagamenti non sono rimborsabili. IVA e altre imposte applicabili sono aggiunte ove previsto.',
    ] }] },
    { title: 'Disponibilità del servizio', blocks: [{ p: `Puntiamo a un’elevata disponibilità ma non garantiamo un servizio ininterrotto. Il servizio può essere influenzato da manutenzione, aggiornamenti, interruzioni, condizioni di rete nel luogo dell’evento e disponibilità di fornitori terzi. ${m ? 'Conserva una tua copia delle foto che per te sono importanti.' : 'Non fare affidamento su di esso come unico mezzo per gestire un momento critico del tuo evento.'}` }] },
    ...(m ? [{ title: 'Eliminazione dei contenuti e chiusura dell’account', blocks: [{ p: 'Puoi eliminare i tuoi album e moderarne i contenuti dal tuo account. Puoi chiederci di chiudere il tuo account in qualsiasi momento. Il modo in cui i dati dell’account e i contenuti sono trattati dopo la chiusura è descritto nell’{{privacy:Informativa sulla privacy}}; possiamo conservare informazioni limitate quando la legge lo richiede (ad esempio i registri di fatturazione).' }] }] : []),
    { title: `Proprietà intellettuale di ${v.short}`, blocks: [{ p: m ? 'Il software, il marchio, l’interfaccia e la documentazione di MIOLOVE ALBUM sono di proprietà di MIOLOVE e protetti dalle leggi applicabili in materia di proprietà intellettuale. I presenti Termini ti concedono soltanto un diritto limitato di utilizzare il servizio.' : 'Il software, il marchio, l’interfaccia e la documentazione di IOMIXO sono di proprietà di IOMIXO e protetti dalle leggi applicabili in materia di proprietà intellettuale. I presenti Termini ti concedono soltanto un diritto limitato di utilizzare il servizio in base al tuo piano.' }] },
    { title: 'Segnalazione di contenuti', blocks: [{ p: m ? 'Se ritieni che una foto o un messaggio mostrato tramite MIOLOVE violi i tuoi diritti, la tua privacy o i tuoi diritti di immagine, o sia illecito, scrivi a {{mail}} indicando il contenuto e spiegando il problema. Lo esamineremo e, se opportuno, rimuoveremo il contenuto o ne disabiliteremo l’accesso.' : 'Se ritieni che un contenuto mostrato tramite IOMIXO violi i tuoi diritti o sia illecito, scrivi a {{mail}} indicando il contenuto e spiegando il problema. Lo esamineremo e, se opportuno, rimuoveremo il contenuto o ne disabiliteremo l’accesso.' }] },
    { title: 'Esclusioni di garanzia', blocks: [{ p: 'Il servizio è fornito **“così com’è” e “come disponibile”** senza garanzie di alcun tipo, nella misura consentita dalla legge, inclusa l’idoneità a uno scopo particolare e il funzionamento ininterrotto o privo di errori.' }] },
    { title: 'Limitazione di responsabilità', blocks: [
      { p: `Nella misura massima consentita dalla legge, ${v.short} non sarà responsabile per danni indiretti, incidentali, speciali o consequenziali, né per mancati profitti, ricavi, dati o avviamento, derivanti dall’uso del servizio. La nostra responsabilità complessiva per qualsiasi reclamo relativo ai presenti Termini o al servizio è limitata all’importo da te pagato a ${v.short} nei dodici (12) mesi precedenti l’evento che ha dato origine al reclamo.` },
      { p: 'Nessuna disposizione dei presenti Termini limita la responsabilità che non può essere esclusa ai sensi della legge applicabile, anche in caso di frode, colpa grave, o morte o lesioni personali causate da negligenza.' },
    ] },
    ...(m ? [] : [{ title: 'Manleva', blocks: [{ p: 'Nella misura consentita dalla legge, ti impegni a tenere indenne IOMIXO da reclami, danni e spese derivanti dai contenuti che tu o i tuoi ospiti inviate tramite i tuoi eventi, dalla violazione dei presenti Termini o dalla violazione di diritti di terzi o della legge applicabile.' }] }]),
    { title: m ? 'Sospensione e cessazione' : 'Sospensione e chiusura', blocks: [{ p: m ? 'Possiamo sospendere o chiudere il tuo account se violi i presenti Termini, abusi del servizio o se richiesto dalla legge. Possiamo conservare informazioni limitate come richiesto dalla legge.' : 'Puoi smettere di utilizzare il servizio e chiederci di chiudere il tuo account in qualsiasi momento. Possiamo sospendere o chiudere il tuo account se violi i presenti Termini, abusi del servizio o se richiesto dalla legge. Possiamo conservare informazioni limitate come richiesto dalla legge (ad esempio i registri di fatturazione).' }] },
    { title: 'Privacy', blocks: [{ p: m ? 'Il modo in cui trattiamo i dati personali, comprese le foto degli ospiti, è descritto nella nostra {{privacy:Informativa sulla privacy}}.' : 'Il modo in cui trattiamo i dati personali è descritto nella nostra {{privacy:Informativa sulla privacy}}.' }] },
    { title: 'Modifiche ai presenti Termini', blocks: [{ p: 'Potremmo aggiornare i presenti Termini di tanto in tanto. Le modifiche sostanziali saranno comunicate via email o tramite un avviso sul servizio almeno 14 giorni prima della loro entrata in vigore. L’uso continuato dopo tale data comporta l’accettazione delle modifiche.' }] },
    { title: 'Legge applicabile e controversie', blocks: [{ p: 'I presenti Termini sono regolati dalla legge italiana, senza riguardo alle norme sul conflitto di leggi. I tribunali italiani hanno giurisdizione esclusiva sulle controversie derivanti dai presenti Termini o dal servizio, salvo che la normativa imperativa a tutela dei consumatori del tuo Paese di residenza ti dia il diritto di agire dinanzi ai tribunali locali.' }] },
    { title: 'Contatti', blocks: [{ p: 'Domande sui presenti Termini: {{mail}}.' }] },
  ]
  return {
    lead: `I presenti Termini di servizio (“Termini”) disciplinano il tuo accesso e utilizzo di ${v.brand} (“${v.short}”, “noi”), ${pick(v, ['una piattaforma interattiva per eventi dal vivo', 'un servizio che consente alle coppie di raccogliere dagli ospiti le foto del proprio matrimonio o evento in un album digitale'])}. Creando un account o utilizzando il servizio accetti i presenti Termini. Se non sei d’accordo, non utilizzare il servizio.`,
    sections: number(secs),
  }
}

const es: LegalBuilders['es'] = (v) => {
  const m = v.miolove
  const secs: Sec[] = [
    { title: 'El servicio', blocks: m ? [{ p: 'Una pareja crea una cuenta y un álbum para su boda o evento, y comparte un código QR o un enlace con los invitados. Los invitados lo abren desde su teléfono, sin instalar ninguna aplicación, y pueden subir fotos a través del Live Booth y, cuando esté habilitado, enviar dedicatorias o mensajes. Las fotos pueden mostrarse en una presentación en directo en una televisión o proyector y se recopilan en el álbum digital del evento.' }] : [
      { p: 'IOMIXO permite a un anfitrión (por ejemplo, un DJ o un organizador de eventos) crear eventos en directo en modo Party o Wedding y compartirlos con los invitados mediante un código QR o un enlace. Según el plan y los ajustes elegidos por el anfitrión, los invitados pueden enviar peticiones de música, dedicatorias y mensajes, responder a encuestas, jugar y subir fotos a través del Live Booth, y el anfitrión puede mostrar contenido en una televisión o proyector con el Modo Pantalla. Los invitados no necesitan instalar ninguna aplicación.' },
      { p: 'IOMIXO no transmite, distribuye ni concede licencias de música. Las peticiones de música son mensajes de texto enviados al anfitrión.' },
    ] },
    { title: 'Requisitos y cuenta', blocks: [{ ul: [
      m ? 'Debes tener al menos 16 años (o la edad de consentimiento digital de tu país) para crear una cuenta.' : 'Debes tener al menos 16 años (o la edad de consentimiento digital de tu país) para usar IOMIXO.',
      'Eres responsable de mantener seguras tus credenciales y de toda la actividad realizada con tu cuenta.',
      'Debes facilitar información precisa de la cuenta y de facturación y mantenerla actualizada.',
    ] }] },
    m ? { title: 'Álbumes, fotos y tu responsabilidad', blocks: [
      { p: '**Quien hace una foto conserva los derechos sobre ella.** Al subir una foto o un mensaje a un álbum, quien lo sube concede a MIOLOVE una licencia limitada, mundial, no exclusiva y gratuita para alojarlo, procesarlo y mostrarlo con el único fin de hacer funcionar el servicio: mostrarlo en el álbum y en la presentación del evento, y ponerlo a disposición del titular del álbum.' },
      { p: '**Eres el único responsable del contenido que subes o publicas y del álbum que creas.** El titular de un álbum es responsable de informar a los invitados sobre la recogida de fotos y de los permisos que exige la ley cuando las fotos muestran personas. Los invitados son responsables de las fotos que suben y deben tener los derechos sobre ellas.' },
      { p: 'El titular de un álbum puede eliminar fotos y mensajes del mismo. También podemos eliminar contenido, a nuestra discreción razonable o ante una denuncia justificada.' },
    ] } : { title: 'Contenido y tu responsabilidad', blocks: [
      { p: '**Conservas la propiedad del contenido que envías**, como peticiones, dedicatorias, respuestas y fotos. Al enviar contenido concedes a IOMIXO una licencia limitada, mundial, no exclusiva y gratuita para alojarlo, procesarlo y mostrarlo con el único fin de hacer funcionar el servicio, incluido mostrarlo a los participantes del evento, en el Modo Pantalla y en la colección de fotos del evento.' },
      { p: '**Eres el único responsable del contenido que envías o publicas a través de tus eventos**, y de contar con todos los derechos, licencias y consentimientos necesarios. Si las fotos muestran a otras personas, eres responsable de contar con el permiso y de dar los avisos que exige la ley. Los anfitriones son responsables del contenido compartido por los invitados en sus eventos y pueden usar las herramientas de moderación disponibles en el servicio.' },
      { p: 'Cualquier música que reproduzcas en un evento, y cualquier licencia o tarifa necesaria para reproducirla públicamente, es responsabilidad tuya y queda fuera del servicio.' },
    ] },
    { title: 'Uso aceptable', blocks: [
      { p: 'Te comprometes a no:' },
      { ul: m ? [
        'subir ni publicar contenido ilegal, ofensivo, de odio, difamatorio o sexualmente explícito, ni contenido que perjudique a menores;',
        'subir imágenes que no tengas derecho a usar o que vulneren la privacidad o los derechos de imagen de otras personas;',
        'subir malware ni interferir en la seguridad o el funcionamiento del servicio;',
        'extraer datos (scraping) ni abusar del servicio o de sus límites;',
        'compartir cuentas ni crear cuentas para eludir una suspensión.',
      ] : [
        'enviar ni publicar contenido ilegal, ofensivo, de odio, difamatorio o sexualmente explícito, ni contenido que perjudique a menores;',
        'infringir los derechos de autor, marcas, derechos de imagen o privacidad de otras personas;',
        'subir malware ni interferir en la seguridad o el funcionamiento del servicio;',
        'aplicar ingeniería inversa, extraer datos (scraping) ni abusar del servicio o de sus límites, ni usarlo para enviar spam;',
        'compartir cuentas ni crear cuentas para eludir una suspensión.',
      ] },
      { p: 'Podemos eliminar contenido y suspender o cerrar las cuentas que, de buena fe, consideremos que infringen estas Condiciones o la ley.' },
    ] },
    m ? { title: 'Planes gratuitos y de pago', blocks: [{ ul: [
      'MIOLOVE puede ofrecer un plan gratuito, periodos de prueba y planes o pases de pago. Lo que incluye cada uno, su precio y las condiciones de cualquier prueba se muestran en el servicio y al finalizar la compra.',
      'Los pagos los procesa Stripe. No vemos ni almacenamos los datos completos de tu tarjeta.',
      'Puedes cancelar una suscripción en cualquier momento desde la página de facturación; la cancelación surte efecto al final del periodo de facturación en curso.',
      'Salvo que la ley lo exija, los pagos no son reembolsables. El IVA u otros impuestos aplicables se añaden cuando corresponda.',
    ] }] } : { title: 'Planes y facturación', blocks: [{ ul: [
      'IOMIXO ofrece un plan gratuito, planes mensuales de pago y un Event Pass único de 24 horas. Las funciones dependen del plan. Los precios y lo que incluye cada plan se muestran en la página de precios y al finalizar la compra.',
      'Los pagos los procesa Stripe. No vemos ni almacenamos los datos completos de tu tarjeta.',
      'Cuando se ofrece una prueba gratuita, su duración y condiciones se muestran al finalizar la compra; una prueba puede terminar sin que se cargue ningún método de pago.',
      'Puedes cancelar una suscripción en cualquier momento desde el portal de facturación; la cancelación surte efecto al final del periodo de facturación en curso.',
      'Salvo que la ley lo exija, los pagos no son reembolsables. El IVA u otros impuestos aplicables se añaden cuando corresponda.',
    ] }] },
    { title: 'Disponibilidad del servicio', blocks: [{ p: `Aspiramos a una alta disponibilidad, pero no garantizamos un servicio ininterrumpido. El servicio puede verse afectado por mantenimiento, actualizaciones, caídas, condiciones de red en el lugar del evento y la disponibilidad de proveedores externos. ${m ? 'Conserva tu propia copia de las fotos que sean importantes para ti.' : 'No dependas de él como único medio para llevar adelante un momento crítico de tu evento.'}` }] },
    ...(m ? [{ title: 'Eliminación de contenido y cierre de la cuenta', blocks: [{ p: 'Puedes eliminar tus álbumes y moderar su contenido desde tu cuenta. Puedes pedirnos en cualquier momento que cerremos tu cuenta. Cómo se tratan los datos de la cuenta y el contenido tras el cierre se describe en la {{privacy:Política de privacidad}}; podemos conservar información limitada cuando la ley lo exija (por ejemplo, registros de facturación).' }] }] : []),
    { title: `Propiedad intelectual de ${v.short}`, blocks: [{ p: m ? 'El software, la marca, la interfaz y la documentación de MIOLOVE ALBUM son propiedad de MIOLOVE y están protegidos por las leyes de propiedad intelectual aplicables. Estas Condiciones solo te otorgan un derecho limitado a usar el servicio.' : 'El software, la marca, la interfaz y la documentación de IOMIXO son propiedad de IOMIXO y están protegidos por las leyes de propiedad intelectual aplicables. Estas Condiciones solo te otorgan un derecho limitado a usar el servicio según tu plan.' }] },
    { title: 'Denuncia de contenido', blocks: [{ p: m ? 'Si crees que una foto o un mensaje mostrado a través de MIOLOVE infringe tus derechos, tu privacidad o tus derechos de imagen, o es ilícito, escribe a {{mail}} identificando el contenido y explicando el problema. Lo revisaremos y, cuando proceda, eliminaremos el contenido o deshabilitaremos el acceso a él.' : 'Si crees que un contenido mostrado a través de IOMIXO infringe tus derechos o es ilícito, escribe a {{mail}} identificando el contenido y explicando el problema. Lo revisaremos y, cuando proceda, eliminaremos el contenido o deshabilitaremos el acceso a él.' }] },
    { title: 'Exención de garantías', blocks: [{ p: 'El servicio se presta **«tal cual» y «según disponibilidad»** sin garantías de ningún tipo, en la medida permitida por la ley, incluida la idoneidad para un fin determinado y el funcionamiento ininterrumpido o sin errores.' }] },
    { title: 'Limitación de responsabilidad', blocks: [
      { p: `En la máxima medida permitida por la ley, ${v.short} no será responsable de daños indirectos, incidentales, especiales o consecuentes, ni de la pérdida de beneficios, ingresos, datos o fondo de comercio, derivados de tu uso del servicio. Nuestra responsabilidad total por cualquier reclamación relacionada con estas Condiciones o con el servicio se limita al importe que hayas pagado a ${v.short} en los doce (12) meses anteriores al hecho que dé lugar a la reclamación.` },
      { p: 'Nada en estas Condiciones limita la responsabilidad que no pueda excluirse conforme a la ley aplicable, incluida la derivada de fraude, negligencia grave, o muerte o lesiones personales causadas por negligencia.' },
    ] },
    ...(m ? [] : [{ title: 'Indemnización', blocks: [{ p: 'En la medida permitida por la ley, te comprometes a mantener indemne a IOMIXO frente a reclamaciones, daños y gastos derivados del contenido que tú o tus invitados enviéis a través de tus eventos, de tu incumplimiento de estas Condiciones o de la vulneración de derechos de terceros o de la ley aplicable.' }] }]),
    { title: m ? 'Suspensión y terminación' : 'Suspensión y cierre', blocks: [{ p: m ? 'Podemos suspender o cerrar tu cuenta si incumples estas Condiciones, abusas del servicio o si la ley lo exige. Podemos conservar información limitada según exija la ley.' : 'Puedes dejar de usar el servicio y pedirnos que cerremos tu cuenta en cualquier momento. Podemos suspender o cerrar tu cuenta si incumples estas Condiciones, abusas del servicio o si la ley lo exige. Podemos conservar información limitada según exija la ley (por ejemplo, registros de facturación).' }] },
    { title: 'Privacidad', blocks: [{ p: m ? 'La forma en que tratamos los datos personales, incluidas las fotos de los invitados, se describe en nuestra {{privacy:Política de privacidad}}.' : 'La forma en que tratamos los datos personales se describe en nuestra {{privacy:Política de privacidad}}.' }] },
    { title: 'Cambios en estas Condiciones', blocks: [{ p: 'Podemos actualizar estas Condiciones de vez en cuando. Los cambios sustanciales se comunicarán por correo electrónico o mediante un aviso en el servicio al menos 14 días antes de que entren en vigor. El uso continuado después de esa fecha supone la aceptación de los cambios.' }] },
    { title: 'Ley aplicable y controversias', blocks: [{ p: 'Estas Condiciones se rigen por las leyes de Italia, sin tener en cuenta las normas sobre conflictos de leyes. Los tribunales de Italia tienen jurisdicción exclusiva sobre las controversias derivadas de estas Condiciones o del servicio, salvo que la legislación imperativa de protección de los consumidores de tu país de residencia te otorgue el derecho a litigar ante tus tribunales locales.' }] },
    { title: 'Contacto', blocks: [{ p: 'Preguntas sobre estas Condiciones: {{mail}}.' }] },
  ]
  return {
    lead: `Estas Condiciones del servicio («Condiciones») regulan tu acceso y uso de ${v.brand} («${v.short}», «nosotros»), ${pick(v, ['una plataforma interactiva para eventos en directo', 'un servicio que permite a las parejas recopilar de sus invitados las fotos de su boda o evento en un álbum digital'])}. Al crear una cuenta o usar el servicio aceptas estas Condiciones. Si no estás de acuerdo, no utilices el servicio.`,
    sections: number(secs),
  }
}

const fr: LegalBuilders['fr'] = (v) => {
  const m = v.miolove
  const secs: Sec[] = [
    { title: 'Le service', blocks: m ? [{ p: 'Un couple crée un compte et un album pour son mariage ou son événement, et partage un QR code ou un lien avec les invités. Les invités l’ouvrent depuis leur téléphone, sans installer d’application, et peuvent téléverser des photos via le Live Booth et, lorsque cela est activé, envoyer des dédicaces ou des messages. Les photos peuvent être affichées dans un diaporama en direct sur un téléviseur ou un projecteur et sont réunies dans l’album numérique de l’événement.' }] : [
      { p: 'IOMIXO permet à un hôte (par exemple un DJ ou un organisateur d’événements) de créer des événements en direct en mode Party ou Wedding et de les partager avec les invités via un QR code ou un lien. Selon le forfait et les réglages choisis par l’hôte, les invités peuvent envoyer des demandes musicales, des dédicaces et des messages, répondre à des sondages, jouer et téléverser des photos via le Live Booth, et l’hôte peut afficher du contenu sur un téléviseur ou un projecteur avec le Mode Écran. Les invités n’ont pas besoin d’installer d’application.' },
      { p: 'IOMIXO ne diffuse, ne distribue ni ne concède sous licence de musique. Les demandes musicales sont des messages texte envoyés à l’hôte.' },
    ] },
    { title: 'Éligibilité et compte', blocks: [{ ul: [
      m ? 'Vous devez avoir au moins 16 ans (ou l’âge du consentement numérique dans votre pays) pour créer un compte.' : 'Vous devez avoir au moins 16 ans (ou l’âge du consentement numérique dans votre pays) pour utiliser IOMIXO.',
      'Vous êtes responsable de la sécurité de vos identifiants et de toute activité effectuée depuis votre compte.',
      'Vous devez fournir des informations exactes sur le compte et la facturation et les tenir à jour.',
    ] }] },
    m ? { title: 'Albums, photos et votre responsabilité', blocks: [
      { p: '**Celui qui prend une photo en conserve les droits.** En téléversant une photo ou un message dans un album, la personne qui le téléverse concède à MIOLOVE une licence limitée, mondiale, non exclusive et gratuite pour l’héberger, la traiter et l’afficher dans le seul but de faire fonctionner le service : l’afficher dans l’album et dans le diaporama de l’événement, et la mettre à la disposition du propriétaire de l’album.' },
      { p: '**Vous êtes seul responsable du contenu que vous téléversez ou publiez, et de l’album que vous créez.** Le propriétaire d’un album est responsable d’informer les invités de la collecte de photos et des autorisations que la loi exige lorsque les photos montrent des personnes. Les invités sont responsables des photos qu’ils téléversent et doivent en détenir les droits.' },
      { p: 'Le propriétaire d’un album peut en retirer des photos et des messages. Nous pouvons également retirer du contenu, à notre discrétion raisonnable ou à la suite d’un signalement motivé.' },
    ] } : { title: 'Contenu et votre responsabilité', blocks: [
      { p: '**Vous conservez la propriété du contenu que vous envoyez**, tel que demandes, dédicaces, réponses et photos. En envoyant du contenu, vous concédez à IOMIXO une licence limitée, mondiale, non exclusive et gratuite pour l’héberger, le traiter et l’afficher dans le seul but de faire fonctionner le service, y compris pour l’afficher aux participants de l’événement, en Mode Écran et dans la collection de photos de l’événement.' },
      { p: '**Vous êtes seul responsable du contenu que vous envoyez ou publiez via vos événements**, et de disposer de tous les droits, licences et consentements nécessaires. Si des photos montrent d’autres personnes, vous êtes responsable d’avoir l’autorisation et de donner les informations que la loi exige. Les hôtes sont responsables du contenu partagé par les invités lors de leurs événements et peuvent utiliser les outils de modération disponibles dans le service.' },
      { p: 'Toute musique que vous diffusez lors d’un événement, ainsi que toute licence ou redevance nécessaire pour la diffuser publiquement, relève de votre responsabilité et est en dehors du service.' },
    ] },
    { title: 'Utilisation acceptable', blocks: [
      { p: 'Vous vous engagez à ne pas :' },
      { ul: m ? [
        'téléverser ou publier de contenu illicite, offensant, haineux, diffamatoire ou sexuellement explicite, ni de contenu portant atteinte aux mineurs ;',
        'téléverser des images que vous n’avez pas le droit d’utiliser ou qui portent atteinte à la vie privée ou au droit à l’image d’autrui ;',
        'téléverser de logiciel malveillant ni perturber la sécurité ou le fonctionnement du service ;',
        'extraire des données (scraping) ni abuser du service ou de ses limites ;',
        'partager des comptes ni créer des comptes pour contourner une suspension.',
      ] : [
        'envoyer ou publier de contenu illicite, offensant, haineux, diffamatoire ou sexuellement explicite, ni de contenu portant atteinte aux mineurs ;',
        'porter atteinte aux droits d’auteur, aux marques, au droit à l’image ou à la vie privée d’autrui ;',
        'téléverser de logiciel malveillant ni perturber la sécurité ou le fonctionnement du service ;',
        'faire de l’ingénierie inverse, extraire des données (scraping) ni abuser du service ou de ses limites, ni l’utiliser pour envoyer du spam ;',
        'partager des comptes ni créer des comptes pour contourner une suspension.',
      ] },
      { p: 'Nous pouvons retirer du contenu et suspendre ou fermer les comptes dont nous estimons, de bonne foi, qu’ils enfreignent les présentes Conditions ou la loi.' },
    ] },
    m ? { title: 'Forfaits gratuits et payants', blocks: [{ ul: [
      'MIOLOVE peut proposer un forfait gratuit, des périodes d’essai et des forfaits ou pass payants. Ce qu’inclut chacun, son prix et les éventuelles conditions d’essai sont indiqués dans le service et au moment du paiement.',
      'Les paiements sont traités par Stripe. Nous ne voyons ni ne conservons les données complètes de votre carte.',
      'Vous pouvez résilier un abonnement à tout moment depuis la page de facturation ; la résiliation prend effet à la fin de la période de facturation en cours.',
      'Sauf disposition légale contraire, les paiements ne sont pas remboursables. La TVA ou les autres taxes applicables sont ajoutées lorsque cela est requis.',
    ] }] } : { title: 'Forfaits et facturation', blocks: [{ ul: [
      'IOMIXO propose un forfait gratuit, des forfaits mensuels payants et un Event Pass unique de 24 heures. Les fonctionnalités dépendent du forfait. Les prix et le contenu de chaque forfait sont indiqués sur la page des tarifs et au moment du paiement.',
      'Les paiements sont traités par Stripe. Nous ne voyons ni ne conservons les données complètes de votre carte.',
      'Lorsqu’un essai gratuit est proposé, sa durée et ses conditions sont indiquées au moment du paiement ; un essai peut prendre fin sans qu’aucun moyen de paiement ne soit débité.',
      'Vous pouvez résilier un abonnement à tout moment depuis le portail de facturation ; la résiliation prend effet à la fin de la période de facturation en cours.',
      'Sauf disposition légale contraire, les paiements ne sont pas remboursables. La TVA ou les autres taxes applicables sont ajoutées lorsque cela est requis.',
    ] }] },
    { title: 'Disponibilité du service', blocks: [{ p: `Nous visons une haute disponibilité mais ne garantissons pas un service ininterrompu. Le service peut être affecté par la maintenance, les mises à jour, les pannes, les conditions réseau sur le lieu de l’événement et la disponibilité de prestataires tiers. ${m ? 'Conservez votre propre copie des photos qui sont importantes pour vous.' : 'Ne vous reposez pas sur lui comme unique moyen de mener un moment critique de votre événement.'}` }] },
    ...(m ? [{ title: 'Suppression du contenu et fermeture du compte', blocks: [{ p: 'Vous pouvez supprimer vos albums et modérer leur contenu depuis votre compte. Vous pouvez nous demander de fermer votre compte à tout moment. La manière dont les données du compte et le contenu sont traités après la fermeture est décrite dans la {{privacy:Politique de confidentialité}} ; nous pouvons conserver des informations limitées lorsque la loi l’exige (par exemple les registres de facturation).' }] }] : []),
    { title: `Propriété intellectuelle de ${v.short}`, blocks: [{ p: m ? 'Le logiciel, la marque, l’interface et la documentation de MIOLOVE ALBUM appartiennent à MIOLOVE et sont protégés par les lois applicables en matière de propriété intellectuelle. Les présentes Conditions ne vous confèrent qu’un droit limité d’utiliser le service.' : 'Le logiciel, la marque, l’interface et la documentation d’IOMIXO appartiennent à IOMIXO et sont protégés par les lois applicables en matière de propriété intellectuelle. Les présentes Conditions ne vous confèrent qu’un droit limité d’utiliser le service selon votre forfait.' }] },
    { title: 'Signalement de contenu', blocks: [{ p: m ? 'Si vous estimez qu’une photo ou un message affiché via MIOLOVE porte atteinte à vos droits, à votre vie privée ou à votre droit à l’image, ou est illicite, écrivez à {{mail}} en identifiant le contenu et en expliquant le problème. Nous l’examinerons et, le cas échéant, retirerons le contenu ou en désactiverons l’accès.' : 'Si vous estimez qu’un contenu affiché via IOMIXO porte atteinte à vos droits ou est illicite, écrivez à {{mail}} en identifiant le contenu et en expliquant le problème. Nous l’examinerons et, le cas échéant, retirerons le contenu ou en désactiverons l’accès.' }] },
    { title: 'Exclusions de garantie', blocks: [{ p: 'Le service est fourni **« tel quel » et « selon disponibilité »** sans garantie d’aucune sorte, dans la mesure permise par la loi, y compris l’aptitude à un usage particulier et un fonctionnement ininterrompu ou sans erreur.' }] },
    { title: 'Limitation de responsabilité', blocks: [
      { p: `Dans toute la mesure permise par la loi, ${v.short} ne sera pas responsable des dommages indirects, accessoires, spéciaux ou consécutifs, ni de la perte de bénéfices, de revenus, de données ou de clientèle, résultant de votre utilisation du service. Notre responsabilité totale pour toute réclamation relative aux présentes Conditions ou au service est limitée au montant que vous avez payé à ${v.short} au cours des douze (12) mois précédant le fait générateur de la réclamation.` },
      { p: 'Rien dans les présentes Conditions ne limite une responsabilité qui ne peut être exclue en vertu de la loi applicable, y compris en cas de fraude, de faute lourde, ou de décès ou de dommage corporel causé par négligence.' },
    ] },
    ...(m ? [] : [{ title: 'Indemnisation', blocks: [{ p: 'Dans la mesure permise par la loi, vous vous engagez à garantir IOMIXO contre les réclamations, dommages et frais résultant du contenu que vous ou vos invités envoyez via vos événements, de votre violation des présentes Conditions, ou de votre violation des droits de tiers ou de la loi applicable.' }] }]),
    { title: m ? 'Suspension et résiliation' : 'Suspension et fermeture', blocks: [{ p: m ? 'Nous pouvons suspendre ou fermer votre compte si vous enfreignez les présentes Conditions, abusez du service, ou si la loi l’exige. Nous pouvons conserver des informations limitées comme l’exige la loi.' : 'Vous pouvez cesser d’utiliser le service et nous demander de fermer votre compte à tout moment. Nous pouvons suspendre ou fermer votre compte si vous enfreignez les présentes Conditions, abusez du service, ou si la loi l’exige. Nous pouvons conserver des informations limitées comme l’exige la loi (par exemple les registres de facturation).' }] },
    { title: 'Confidentialité', blocks: [{ p: m ? 'La manière dont nous traitons les données personnelles, y compris les photos des invités, est décrite dans notre {{privacy:Politique de confidentialité}}.' : 'La manière dont nous traitons les données personnelles est décrite dans notre {{privacy:Politique de confidentialité}}.' }] },
    { title: 'Modifications des présentes Conditions', blocks: [{ p: 'Nous pouvons mettre à jour les présentes Conditions de temps à autre. Les modifications importantes seront communiquées par e-mail ou par un avis sur le service au moins 14 jours avant leur entrée en vigueur. La poursuite de l’utilisation après cette date vaut acceptation des modifications.' }] },
    { title: 'Droit applicable et litiges', blocks: [{ p: 'Les présentes Conditions sont régies par le droit italien, sans égard aux règles de conflit de lois. Les tribunaux italiens ont compétence exclusive pour les litiges découlant des présentes Conditions ou du service, sauf si la législation impérative de protection des consommateurs de votre pays de résidence vous donne le droit d’agir devant vos tribunaux locaux.' }] },
    { title: 'Contact', blocks: [{ p: 'Questions sur les présentes Conditions : {{mail}}.' }] },
  ]
  return {
    lead: `Les présentes Conditions d’utilisation (« Conditions ») régissent votre accès à ${v.brand} (« ${v.short} », « nous ») et son utilisation, ${pick(v, ['une plateforme interactive pour événements en direct', 'un service qui permet aux couples de recueillir auprès des invités les photos de leur mariage ou événement dans un album numérique'])}. En créant un compte ou en utilisant le service, vous acceptez les présentes Conditions. Si vous n’êtes pas d’accord, n’utilisez pas le service.`,
    sections: number(secs),
  }
}

export const TERMS: LegalBuilders = { en, it, es, fr }
export type { LegalVars }

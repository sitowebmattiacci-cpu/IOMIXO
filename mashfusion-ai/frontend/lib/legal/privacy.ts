import { pick, type LegalBuilders } from './types'

const en: LegalBuilders['en'] = (v) => ({
  lead: `This Privacy Policy describes how ${v.name} (“we”, “us”) collects, uses, and protects information when you use ${v.brand}, our ${pick(v, ['live event interaction service', 'digital wedding and event photo album service'])}. By using ${v.name} you agree to the practices described here. If you do not agree, do not use the service.`,
  sections: [
    { title: '1. Data we collect', blocks: [
      { p: 'We collect the data needed to operate the service:' },
      { ul: [
        '**Account data** — email address, the name you provide, and account creation data. Sign-in is handled by Firebase Authentication; we do not see or store your password.',
        `**${pick(v, ['Event content', 'Album content'])}** — ${pick(v, ['content you and your guests submit during live events, such as music requests, dedications, poll responses, game answers, and photos', 'photos that guests upload through the Live Booth, and any dedications or messages they send'])}.`,
        '**Guest participation** — guests join through a QR code or link without creating an account; they are signed in anonymously with a random identifier, plus any name or text they choose to enter.',
        '**Billing data** — handled by Stripe (we never see or store full card details). We retain plan, subscription status, customer ID, and payment history metadata.',
        '**Technical data** — IP address, user agent, and security signals from App Check and reCAPTCHA Enterprise, used to keep the service working and to prevent abuse.',
      ] },
    ] },
    { title: '2. How we use your data', blocks: [
      { ul: [
        pick(v, ['To run your live events and display the content you and your guests submit.', 'To run your albums and display the photos and messages guests submit.']),
        'To manage your subscription and billing.',
        'To provide customer support and respond to your requests.',
        'To detect abuse, fraud, and violations of our Terms of Service.',
        'To comply with legal obligations (tax records, lawful requests from authorities).',
      ] },
      { p: `We do **not** sell your data or use ${pick(v, ['your event content', 'your photos'])} for advertising.` },
    ] },
    { title: '3. Storage and retention', blocks: [{ ul: [
      `**${pick(v, ['Event content', 'Album content'])}** remains available in your account until you delete it or your account is closed.`,
      '**Account and billing records** are retained as long as your account is active, plus the period required by tax and accounting law.',
      '**Technical logs** are retained only as long as needed for security, operation and abuse prevention.',
    ] }] },
    { title: '4. Service providers', blocks: [
      { p: 'We share data only with providers needed to operate the service:' },
      { ul: [
        '**Google Firebase / Google Cloud** — Firebase Authentication, Cloud Firestore (database), Firebase Storage (files and photos), Cloud Functions (backend) and Firebase App Hosting (web hosting). Our Cloud Functions run in europe-west1 and our web hosting in europe-west4.',
        '**Google App Check and reCAPTCHA Enterprise** — protection against abuse and fraud.',
        '**Stripe** — payment processing. Stripe’s privacy policy applies to card data.',
      ] },
      { p: 'Each provider acts under data protection terms compatible with GDPR.' },
    ] },
    { title: '5. Your rights (GDPR)', blocks: [
      { p: 'If you are in the European Economic Area you have the right to:' },
      { ul: [
        'Access the personal data we hold about you.',
        'Correct inaccurate data.',
        'Request deletion of your account and associated data (subject to legal retention obligations).',
        'Export your data in a portable format.',
        'Object to processing or withdraw consent where processing is based on consent.',
        'Lodge a complaint with your local supervisory authority.',
      ] },
      { p: 'To exercise any of these rights, contact us at {{mail}}. We respond within 30 days.' },
    ] },
    { title: '6. Security', blocks: [{ p: 'We use TLS encryption in transit and access rules on our database and storage that limit who can read or change data. No system is perfectly secure: if we discover a breach affecting your data, we will notify you and the relevant authorities as required by law.' }] },
    { title: '7. Cookies and local storage', blocks: [{ p: `We use only what is needed for the service to work: your sign-in session and your language and interface preferences${pick(v, [', and a note on your device that you already voted in a poll', ''])}. Google reCAPTCHA Enterprise may use cookies or similar technologies for security. We do not use advertising cookies or analytics trackers.` }] },
    { title: '8. Children', blocks: [{ p: `${v.name} is not directed to children under 16. If you become aware that a minor has provided us personal data without parental consent, contact us and we will delete it.` }] },
    { title: '9. Changes to this policy', blocks: [{ p: 'We may update this Privacy Policy. Material changes will be communicated via email to active account holders or via a notice on the service at least 14 days before they take effect.' }] },
    { title: '10. Contact', blocks: [{ p: 'Questions about this policy or your data: {{mail}}.' }] },
  ],
})

const it: LegalBuilders['it'] = (v) => ({
  lead: `La presente Informativa sulla privacy descrive come ${v.name} (“noi”) raccoglie, utilizza e protegge le informazioni quando utilizzi ${v.brand}, il nostro ${pick(v, ['servizio di interazione per eventi dal vivo', 'servizio di album fotografici digitali per matrimoni ed eventi'])}. Utilizzando ${v.name} accetti le pratiche qui descritte. Se non sei d’accordo, non utilizzare il servizio.`,
  sections: [
    { title: '1. Dati che raccogliamo', blocks: [
      { p: 'Raccogliamo i dati necessari per far funzionare il servizio:' },
      { ul: [
        '**Dati dell’account** — indirizzo email, il nome che fornisci e i dati di creazione dell’account. L’accesso è gestito da Firebase Authentication; non vediamo né conserviamo la tua password.',
        `**${pick(v, ['Contenuti dell’evento', 'Contenuti dell’album'])}** — ${pick(v, ['i contenuti che tu e i tuoi ospiti inviate durante gli eventi dal vivo, come richieste musicali, dediche, risposte ai sondaggi, risposte ai giochi e foto', 'le foto che gli ospiti caricano tramite il Live Booth e le eventuali dediche o messaggi che inviano'])}.`,
        '**Partecipazione degli ospiti** — gli ospiti accedono tramite un codice QR o un link senza creare un account; vengono autenticati in modo anonimo con un identificativo casuale, oltre a qualsiasi nome o testo che scelgano di inserire.',
        '**Dati di fatturazione** — gestiti da Stripe (non vediamo né conserviamo mai i dati completi della carta). Conserviamo il piano, lo stato dell’abbonamento, l’ID cliente e i metadati dello storico dei pagamenti.',
        '**Dati tecnici** — indirizzo IP, user agent e segnali di sicurezza di App Check e reCAPTCHA Enterprise, utilizzati per mantenere il servizio funzionante e per prevenire abusi.',
      ] },
    ] },
    { title: '2. Come utilizziamo i tuoi dati', blocks: [
      { ul: [
        pick(v, ['Per gestire i tuoi eventi dal vivo e mostrare i contenuti inviati da te e dai tuoi ospiti.', 'Per gestire i tuoi album e mostrare le foto e i messaggi inviati dagli ospiti.']),
        'Per gestire il tuo abbonamento e la fatturazione.',
        'Per fornire assistenza clienti e rispondere alle tue richieste.',
        'Per individuare abusi, frodi e violazioni dei nostri Termini di servizio.',
        'Per adempiere agli obblighi di legge (registri fiscali, richieste legittime delle autorità).',
      ] },
      { p: `**Non** vendiamo i tuoi dati e non utilizziamo ${pick(v, ['i contenuti dei tuoi eventi', 'le tue foto'])} per la pubblicità.` },
    ] },
    { title: '3. Conservazione dei dati', blocks: [{ ul: [
      `**${pick(v, ['I contenuti dell’evento', 'I contenuti dell’album'])}** restano disponibili nel tuo account finché non li elimini o l’account viene chiuso.`,
      '**I registri dell’account e di fatturazione** sono conservati finché il tuo account è attivo, più il periodo richiesto dalla normativa fiscale e contabile.',
      '**I log tecnici** sono conservati solo per il tempo necessario alla sicurezza, al funzionamento del servizio e alla prevenzione degli abusi.',
    ] }] },
    { title: '4. Fornitori di servizi', blocks: [
      { p: 'Condividiamo i dati solo con i fornitori necessari per far funzionare il servizio:' },
      { ul: [
        '**Google Firebase / Google Cloud** — Firebase Authentication, Cloud Firestore (database), Firebase Storage (file e foto), Cloud Functions (backend) e Firebase App Hosting (hosting web). Le nostre Cloud Functions sono eseguite in europe-west1 e il nostro hosting web in europe-west4.',
        '**Google App Check e reCAPTCHA Enterprise** — protezione da abusi e frodi.',
        '**Stripe** — elaborazione dei pagamenti. Ai dati della carta si applica l’informativa sulla privacy di Stripe.',
      ] },
      { p: 'Ogni fornitore opera in base a condizioni di protezione dei dati compatibili con il GDPR.' },
    ] },
    { title: '5. I tuoi diritti (GDPR)', blocks: [
      { p: 'Se ti trovi nello Spazio economico europeo hai il diritto di:' },
      { ul: [
        'accedere ai dati personali che conserviamo su di te;',
        'correggere i dati inesatti;',
        'richiedere la cancellazione del tuo account e dei dati associati (fatti salvi gli obblighi legali di conservazione);',
        'esportare i tuoi dati in un formato portabile;',
        'opporti al trattamento o revocare il consenso quando il trattamento si basa sul consenso;',
        'presentare reclamo all’autorità di controllo locale.',
      ] },
      { p: 'Per esercitare uno qualsiasi di questi diritti, contattaci all’indirizzo {{mail}}. Rispondiamo entro 30 giorni.' },
    ] },
    { title: '6. Sicurezza', blocks: [{ p: 'Utilizziamo la crittografia TLS in transito e regole di accesso sul nostro database e sullo storage che limitano chi può leggere o modificare i dati. Nessun sistema è perfettamente sicuro: se scopriamo una violazione che riguarda i tuoi dati, informeremo te e le autorità competenti come richiesto dalla legge.' }] },
    { title: '7. Cookie e archiviazione locale', blocks: [{ p: `Utilizziamo solo ciò che serve al funzionamento del servizio: la tua sessione di accesso e le tue preferenze di lingua e di interfaccia${pick(v, [' e una nota sul tuo dispositivo che indica che hai già votato in un sondaggio', ''])}. Google reCAPTCHA Enterprise può utilizzare cookie o tecnologie simili per la sicurezza. Non utilizziamo cookie pubblicitari né strumenti di tracciamento per le analisi.` }] },
    { title: '8. Minori', blocks: [{ p: `${v.name} non è rivolto a minori di 16 anni. Se vieni a conoscenza del fatto che un minore ci ha fornito dati personali senza il consenso dei genitori, contattaci e li cancelleremo.` }] },
    { title: '9. Modifiche alla presente informativa', blocks: [{ p: 'Potremmo aggiornare la presente Informativa sulla privacy. Le modifiche sostanziali saranno comunicate via email ai titolari di account attivi o tramite un avviso sul servizio almeno 14 giorni prima della loro entrata in vigore.' }] },
    { title: '10. Contatti', blocks: [{ p: 'Domande sulla presente informativa o sui tuoi dati: {{mail}}.' }] },
  ],
})

const es: LegalBuilders['es'] = (v) => ({
  lead: `Esta Política de privacidad describe cómo ${v.name} («nosotros») recopila, utiliza y protege la información cuando usas ${v.brand}, nuestro ${pick(v, ['servicio de interacción para eventos en directo', 'servicio de álbumes de fotos digitales para bodas y eventos'])}. Al usar ${v.name} aceptas las prácticas aquí descritas. Si no estás de acuerdo, no utilices el servicio.`,
  sections: [
    { title: '1. Datos que recopilamos', blocks: [
      { p: 'Recopilamos los datos necesarios para hacer funcionar el servicio:' },
      { ul: [
        '**Datos de la cuenta** — dirección de correo electrónico, el nombre que facilitas y los datos de creación de la cuenta. El inicio de sesión lo gestiona Firebase Authentication; no vemos ni almacenamos tu contraseña.',
        `**${pick(v, ['Contenido del evento', 'Contenido del álbum'])}** — ${pick(v, ['el contenido que tú y tus invitados enviáis durante los eventos en directo, como peticiones de música, dedicatorias, respuestas a encuestas, respuestas a juegos y fotos', 'las fotos que los invitados suben a través del Live Booth y las dedicatorias o mensajes que envíen'])}.`,
        '**Participación de los invitados** — los invitados acceden mediante un código QR o un enlace sin crear una cuenta; inician sesión de forma anónima con un identificador aleatorio, además del nombre o texto que decidan introducir.',
        '**Datos de facturación** — gestionados por Stripe (nunca vemos ni almacenamos los datos completos de la tarjeta). Conservamos el plan, el estado de la suscripción, el ID de cliente y los metadatos del historial de pagos.',
        '**Datos técnicos** — dirección IP, agente de usuario y señales de seguridad de App Check y reCAPTCHA Enterprise, utilizados para mantener el servicio en funcionamiento y prevenir abusos.',
      ] },
    ] },
    { title: '2. Cómo usamos tus datos', blocks: [
      { ul: [
        pick(v, ['Para gestionar tus eventos en directo y mostrar el contenido que tú y tus invitados enviáis.', 'Para gestionar tus álbumes y mostrar las fotos y los mensajes que envían los invitados.']),
        'Para gestionar tu suscripción y la facturación.',
        'Para prestar atención al cliente y responder a tus solicitudes.',
        'Para detectar abusos, fraudes e infracciones de nuestras Condiciones del servicio.',
        'Para cumplir obligaciones legales (registros fiscales, requerimientos legítimos de las autoridades).',
      ] },
      { p: `**No** vendemos tus datos ni usamos ${pick(v, ['el contenido de tus eventos', 'tus fotos'])} con fines publicitarios.` },
    ] },
    { title: '3. Almacenamiento y conservación', blocks: [{ ul: [
      `**${pick(v, ['El contenido del evento', 'El contenido del álbum'])}** permanece disponible en tu cuenta hasta que lo elimines o se cierre tu cuenta.`,
      '**Los registros de la cuenta y de facturación** se conservan mientras tu cuenta esté activa, más el período exigido por la legislación fiscal y contable.',
      '**Los registros técnicos** se conservan solo el tiempo necesario para la seguridad, el funcionamiento y la prevención de abusos.',
    ] }] },
    { title: '4. Proveedores de servicios', blocks: [
      { p: 'Compartimos datos únicamente con los proveedores necesarios para hacer funcionar el servicio:' },
      { ul: [
        '**Google Firebase / Google Cloud** — Firebase Authentication, Cloud Firestore (base de datos), Firebase Storage (archivos y fotos), Cloud Functions (backend) y Firebase App Hosting (alojamiento web). Nuestras Cloud Functions se ejecutan en europe-west1 y nuestro alojamiento web en europe-west4.',
        '**Google App Check y reCAPTCHA Enterprise** — protección contra abusos y fraudes.',
        '**Stripe** — procesamiento de pagos. A los datos de la tarjeta se aplica la política de privacidad de Stripe.',
      ] },
      { p: 'Cada proveedor actúa conforme a condiciones de protección de datos compatibles con el RGPD.' },
    ] },
    { title: '5. Tus derechos (RGPD)', blocks: [
      { p: 'Si te encuentras en el Espacio Económico Europeo, tienes derecho a:' },
      { ul: [
        'acceder a los datos personales que conservamos sobre ti;',
        'rectificar los datos inexactos;',
        'solicitar la eliminación de tu cuenta y de los datos asociados (sin perjuicio de las obligaciones legales de conservación);',
        'exportar tus datos en un formato portable;',
        'oponerte al tratamiento o retirar el consentimiento cuando el tratamiento se base en él;',
        'presentar una reclamación ante tu autoridad de control local.',
      ] },
      { p: 'Para ejercer cualquiera de estos derechos, escríbenos a {{mail}}. Respondemos en un plazo de 30 días.' },
    ] },
    { title: '6. Seguridad', blocks: [{ p: 'Utilizamos cifrado TLS en tránsito y reglas de acceso en nuestra base de datos y almacenamiento que limitan quién puede leer o modificar los datos. Ningún sistema es perfectamente seguro: si descubrimos una brecha que afecte a tus datos, te lo notificaremos a ti y a las autoridades competentes según exija la ley.' }] },
    { title: '7. Cookies y almacenamiento local', blocks: [{ p: `Usamos únicamente lo necesario para que el servicio funcione: tu sesión de inicio de sesión y tus preferencias de idioma e interfaz${pick(v, [', y una nota en tu dispositivo que indica que ya has votado en una encuesta', ''])}. Google reCAPTCHA Enterprise puede utilizar cookies o tecnologías similares por motivos de seguridad. No utilizamos cookies publicitarias ni herramientas de seguimiento analítico.` }] },
    { title: '8. Menores', blocks: [{ p: `${v.name} no está dirigido a menores de 16 años. Si tienes conocimiento de que un menor nos ha facilitado datos personales sin el consentimiento de sus padres, contáctanos y los eliminaremos.` }] },
    { title: '9. Cambios en esta política', blocks: [{ p: 'Podemos actualizar esta Política de privacidad. Los cambios sustanciales se comunicarán por correo electrónico a los titulares de cuentas activas o mediante un aviso en el servicio al menos 14 días antes de que entren en vigor.' }] },
    { title: '10. Contacto', blocks: [{ p: 'Preguntas sobre esta política o sobre tus datos: {{mail}}.' }] },
  ],
})

const fr: LegalBuilders['fr'] = (v) => ({
  lead: `La présente Politique de confidentialité décrit la manière dont ${v.name} (« nous ») collecte, utilise et protège les informations lorsque vous utilisez ${v.brand}, notre ${pick(v, ['service d’interaction pour événements en direct', 'service d’albums photo numériques pour mariages et événements'])}. En utilisant ${v.name}, vous acceptez les pratiques décrites ici. Si vous n’êtes pas d’accord, n’utilisez pas le service.`,
  sections: [
    { title: '1. Données que nous collectons', blocks: [
      { p: 'Nous collectons les données nécessaires au fonctionnement du service :' },
      { ul: [
        '**Données du compte** — adresse e-mail, le nom que vous fournissez et les données de création du compte. La connexion est gérée par Firebase Authentication ; nous ne voyons ni ne conservons votre mot de passe.',
        `**${pick(v, ['Contenu de l’événement', 'Contenu de l’album'])}** — ${pick(v, ['le contenu que vous et vos invités envoyez pendant les événements en direct, tel que demandes musicales, dédicaces, réponses aux sondages, réponses aux jeux et photos', 'les photos que les invités téléversent via le Live Booth, ainsi que les dédicaces ou messages qu’ils envoient'])}.`,
        '**Participation des invités** — les invités rejoignent via un QR code ou un lien sans créer de compte ; ils sont connectés de façon anonyme avec un identifiant aléatoire, ainsi que le nom ou le texte qu’ils choisissent de saisir.',
        '**Données de facturation** — gérées par Stripe (nous ne voyons ni ne conservons jamais les données complètes de la carte). Nous conservons le forfait, l’état de l’abonnement, l’identifiant client et les métadonnées de l’historique des paiements.',
        '**Données techniques** — adresse IP, agent utilisateur et signaux de sécurité d’App Check et de reCAPTCHA Enterprise, utilisés pour assurer le fonctionnement du service et prévenir les abus.',
      ] },
    ] },
    { title: '2. Comment nous utilisons vos données', blocks: [
      { ul: [
        pick(v, ['Pour faire fonctionner vos événements en direct et afficher le contenu que vous et vos invités envoyez.', 'Pour faire fonctionner vos albums et afficher les photos et les messages envoyés par les invités.']),
        'Pour gérer votre abonnement et la facturation.',
        'Pour assurer l’assistance client et répondre à vos demandes.',
        'Pour détecter les abus, les fraudes et les violations de nos Conditions d’utilisation.',
        'Pour respecter nos obligations légales (registres fiscaux, demandes légales des autorités).',
      ] },
      { p: `Nous ne vendons **pas** vos données et n’utilisons pas ${pick(v, ['le contenu de vos événements', 'vos photos'])} à des fins publicitaires.` },
    ] },
    { title: '3. Stockage et conservation', blocks: [{ ul: [
      `**${pick(v, ['Le contenu de l’événement', 'Le contenu de l’album'])}** reste disponible dans votre compte jusqu’à ce que vous le supprimiez ou que votre compte soit fermé.`,
      '**Les registres du compte et de facturation** sont conservés tant que votre compte est actif, ainsi que pendant la durée exigée par le droit fiscal et comptable.',
      '**Les journaux techniques** ne sont conservés que le temps nécessaire à la sécurité, au fonctionnement et à la prévention des abus.',
    ] }] },
    { title: '4. Prestataires de services', blocks: [
      { p: 'Nous ne partageons des données qu’avec les prestataires nécessaires au fonctionnement du service :' },
      { ul: [
        '**Google Firebase / Google Cloud** — Firebase Authentication, Cloud Firestore (base de données), Firebase Storage (fichiers et photos), Cloud Functions (backend) et Firebase App Hosting (hébergement web). Nos Cloud Functions s’exécutent en europe-west1 et notre hébergement web en europe-west4.',
        '**Google App Check et reCAPTCHA Enterprise** — protection contre les abus et la fraude.',
        '**Stripe** — traitement des paiements. La politique de confidentialité de Stripe s’applique aux données de carte.',
      ] },
      { p: 'Chaque prestataire agit selon des conditions de protection des données compatibles avec le RGPD.' },
    ] },
    { title: '5. Vos droits (RGPD)', blocks: [
      { p: 'Si vous vous trouvez dans l’Espace économique européen, vous avez le droit de :' },
      { ul: [
        'accéder aux données personnelles que nous détenons à votre sujet ;',
        'faire rectifier les données inexactes ;',
        'demander la suppression de votre compte et des données associées (sous réserve des obligations légales de conservation) ;',
        'exporter vos données dans un format portable ;',
        'vous opposer au traitement ou retirer votre consentement lorsque le traitement repose sur le consentement ;',
        'introduire une réclamation auprès de votre autorité de contrôle locale.',
      ] },
      { p: 'Pour exercer l’un de ces droits, contactez-nous à {{mail}}. Nous répondons dans un délai de 30 jours.' },
    ] },
    { title: '6. Sécurité', blocks: [{ p: 'Nous utilisons le chiffrement TLS en transit et des règles d’accès sur notre base de données et notre stockage qui limitent qui peut lire ou modifier les données. Aucun système n’est parfaitement sûr : si nous découvrons une violation touchant vos données, nous vous en informerons, ainsi que les autorités compétentes, comme l’exige la loi.' }] },
    { title: '7. Cookies et stockage local', blocks: [{ p: `Nous n’utilisons que ce qui est nécessaire au fonctionnement du service : votre session de connexion et vos préférences de langue et d’interface${pick(v, [', ainsi qu’une note sur votre appareil indiquant que vous avez déjà voté à un sondage', ''])}. Google reCAPTCHA Enterprise peut utiliser des cookies ou des technologies similaires à des fins de sécurité. Nous n’utilisons ni cookies publicitaires ni traceurs d’analyse.` }] },
    { title: '8. Enfants', blocks: [{ p: `${v.name} ne s’adresse pas aux enfants de moins de 16 ans. Si vous apprenez qu’un mineur nous a fourni des données personnelles sans le consentement de ses parents, contactez-nous et nous les supprimerons.` }] },
    { title: '9. Modifications de cette politique', blocks: [{ p: 'Nous pouvons mettre à jour la présente Politique de confidentialité. Les modifications importantes seront communiquées par e-mail aux titulaires de comptes actifs ou par un avis sur le service au moins 14 jours avant leur entrée en vigueur.' }] },
    { title: '10. Contact', blocks: [{ p: 'Questions sur cette politique ou sur vos données : {{mail}}.' }] },
  ],
})

export const PRIVACY: LegalBuilders = { en, it, es, fr }

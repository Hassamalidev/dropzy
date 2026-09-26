// Every user-facing string lives here (SPEC rule 3). Wording for key moments follows §6.4.
// The UI never says P2P, WebRTC, E2EE, presigned, WebSocket or OPFS (§6.1).

export const brand = 'Dropzy';
export const siteHost = 'dropzy.app';

export const t = {
  brand,

  // Global layout (§6.2)
  topBar: 'No sign-up · No tracking · Everything deletes itself',
  contact: 'Contact',
  requestFeature: 'Request a feature',
  skipToContent: 'Skip to content',
  themeToggle: 'Switch light or dark theme',
  nav: {
    label: 'Sharing modes',
    wifi: 'Wi-Fi',
    private: 'Private',
    room: 'Room',
    join: 'Join',
    wifiLong: 'Wi-Fi Share',
    privateLong: 'Private Share',
    roomLong: 'Create Room',
    joinLong: 'Join Room',
  },
  footer: {
    copyright: (year: number) => `© ${year} ${brand} · Everything you share here deletes itself.`,
    howItWorks: 'How it works',
    about: 'About',
    privacy: 'Privacy',
    terms: 'Terms',
  },
  feature: {
    title: 'Request a feature',
    prompt: `What would make ${brand} better for you?`,
    email: 'Your email (optional)',
    emailHint: 'Only if you’d like a reply.',
    send: 'Send',
    sending: 'Sending…',
    thanks: 'Thanks! We read every one.',
    failed: 'Couldn’t send that. Try again in a moment.',
    close: 'Close',
  },

  // Heroes (§6.3.1)
  hero: {
    wifi: {
      title: 'Open it on both devices. That’s it.',
      subtitle: 'Share files and text with every device on the same Wi-Fi.',
      active: 'Wi-Fi sharing active',
    },
    ses: {
      title: 'Just Between You Two',
      subtitle: '', // the session card below says the rest
      active: 'Private share active',
    },
    room: {
      title: 'A room for your group.',
      subtitle: 'Everyone with the 6-digit code can share files and text here.',
      active: 'Room active',
    },
    reconnecting: 'Reconnecting…',
    openOther: 'Open on another device',
  },

  // Devices (§6.3.2)
  devices: {
    arrived: (name: string, type: string) => `${name} (${type}) is here`,
    cancel: 'Cancel',
  },

  // Connect card (§6.3.3)
  connect: {
    wifiLine1: `Open ${siteHost} on your other device — it should appear here.`,
    wifiLine2: (code: string) => `Not showing up? Scan this QR, or tap Join and enter ${code}.`,
    wifiLine2NoCode: 'Not showing up? Scan this QR with your other device.',
    differentNetworks: 'On different networks? Start a Private Share',
    privateTitle: 'Open this link on the other device',
    roomTitle: 'Invite people to this room',
    roomHint: 'Scan the QR, open the link, or enter the code on the Join page.',
    copyLink: 'Copy link',
    copyJoinLink: 'Copy join link',
    connectedByCode: 'Connected by code',
    leave: 'Leave',
    pairCode: 'Pair code',
    passExpires: 'This code works for 10 minutes.',
    loading: 'Making a code…',
  },

  // Status card (§6.3.4)
  status: {
    e2ee: 'End-to-end encrypted',
    endsIn: (d: string) => `Ends in ${d}`,
    extend: 'Extend',
    extendPrivate: '+2 h',
    extendRoom: '+24 h',
    maxReached: 'Maximum length reached',
    extended: 'Extended.',
    lockRoom: 'Lock room',
    locked: 'Room locked. Nobody new can join.',
    unlocked: 'Room unlocked.',
    roomCode: 'Room code',
    copyCode: 'Copy code',
    link: 'Share link',
    enlargeQr: 'Show a bigger QR code',
    endingSoon: 'This share ends in 10 minutes.',
    keepLonger: 'Keep it longer',
  },

  // Files panel (§6.3.5)
  files: {
    title: 'Share files',
    count: (n: number) => `${n} shared`,
    drop: 'Drop files here',
    tap: 'Tap to choose files',
    choose: 'Choose files',
    hintBoth: (up: string) => `Up to ${up} per file · Bigger files go direct`,
    hintDirectOnly: 'Goes straight to devices that are here',
    hintUploadOnly: (up: string) => `Up to ${up} per file`,
    dropOverlay: 'Drop to share',
    burn: 'Delete after 1 download',
    empty: {
      wifi: 'Files shared on this Wi-Fi appear here.',
      ses: 'Files shared in this private share appear here.',
      room: 'Files shared in this room appear here.',
    },
    noMatches: 'No files match your search.',
    downloadAll: 'Download all',
    downloadAllSkipped: (n: number) =>
      `${n} ${n === 1 ? 'item was' : 'items were'} skipped (sent directly or one-download only).`,
    zipName: 'dropzy-files.zip',
    zipping: 'Preparing your download…',
  },

  // File item statuses
  item: {
    sendingDirect: (pct: number, speed: string) => `Sending directly · ${pct}% · ${speed}`,
    sentDirect: (name: string) => `Sent directly to ${name} ✓`,
    sentDirectNever: 'Sent directly — never uploaded',
    receiving: (name: string, pct: number) => `Receiving from ${name} · ${pct}%`,
    received: (name: string) => `Received from ${name} — never uploaded`,
    uploading: (pct: number, speed: string) => `Uploading · ${pct}% · ${speed}`,
    othersUploading: (name: string, pct: number) => `${name} is uploading… ${pct}%`,
    waiting: 'Waiting…',
    availableFor: (d: string) => `Available for ${d}`,
    burn: 'Deletes after 1 download',
    timeLeft: (d: string) => `${d} left`,
    expiresIn: (d: string) => `Expires in ${d}`,
    download: 'Download',
    save: 'Save',
    saved: 'Saved',
    saveToPhotos: 'Save to Photos',
    tapToSave: 'Tap to save',
    preparing: (pct: number) => `Getting it ready… ${pct}%`,
    copyLink: 'Copy link',
    keySent: (name: string) => `Sent ${name} to a device that entered its code`,
    qr: 'QR code',
    qrTitle: 'Scan to download',
    orCode: 'Or enter',
    at: (where: string) => `at ${where}`,
    delete: 'Delete',
    cancel: 'Cancel',
    more: 'More actions',
    makeAvailable: 'Make available for later',
    report: 'Report',
    from: (name: string) => `from ${name}`,
    you: 'you',
    encrypted: 'Encrypted',
    code: 'Search code',
    riskyTitle: 'Open this file?',
    risky: 'Only open files from people you trust.',
    riskyConfirm: 'Download anyway',
    preview: 'Preview',
    closePreview: 'Close preview',
    failed: 'That didn’t work. Try again.',
    uploadFailed: 'The upload didn’t finish. Try again.',
    cancelled: 'Upload cancelled.',
    gone: 'That’s no longer available.',
  },

  // Text panel (§6.3.5)
  text: {
    title: 'Share text',
    toShare: 'to share',
    count: (n: number) => `${n} shared`,
    shared: (d: string) => `Shared — expires in ${d}`,
    pasteSend: 'Paste & send',
    copyLatest: 'Copy latest',
    placeholder: 'Paste or type text to share…',
    share: 'Share',
    clear: 'Clear',
    copy: 'Copy',
    copied: 'Copied!',
    qr: 'QR',
    qrTitle: 'Scan to copy this text',
    showMore: 'Show more',
    showLess: 'Show less',
    empty: {
      wifi: 'Text shared on this Wi-Fi appears here.',
      ses: 'Text shared in this private share appears here.',
      room: 'Text shared in this room appears here.',
    },
    noMatches: 'No text matches your search.',
    pasteHint: 'Press Ctrl+V (⌘V on Mac) to paste',
    nothingToCopy: 'There’s no text here yet.',
    tooLong: 'That’s too long — keep it under 50,000 characters.',
    shortcut: 'Ctrl + Enter to share',
    shortcutMac: '⌘ + Enter to share',
  },

  // Search across files and text
  search: {
    label: 'Search shared items',
    placeholder: 'Search code, name or text',
    shortcut: 'Press / to search',
    clear: 'Clear search',
  },

  // Info row (§6.3.6)
  info: {
    wifi: {
      scope: 'Everyone on this Wi-Fi can see what’s shared here.',
      chips: [
        ['zap', 'Big files go direct'],
        ['clock', 'Expires 2 h after adding'],
        ['user', 'No sign-up'],
      ],
    },
    ses: {
      scope: 'Only people with this link can get in.',
      chips: [
        ['lock', 'End-to-end encrypted'],
        ['clock', 'Up to 6 hours'],
        ['user', 'No sign-up'],
      ],
    },
    room: {
      scope: 'Anyone with the code can see and change what’s here.',
      chips: [
        ['lock', 'Lock anytime'],
        ['clock', 'Up to 48 hours'],
        ['user', 'No sign-up'],
      ],
    },
  },

  // Key moments (§6.4)
  moments: {
    directFailed: 'Couldn’t connect directly, so we’re uploading it instead.',
    offlineUpload: 'You’re offline. We’ll pick up where we left off.',
    tooBigNobody:
      'Files over 2 GB can only go directly. Open Dropzy on the other device and keep both open.',
    tooBig: (size: string) =>
      `Files over ${size} can only go directly. Open Dropzy on the other device and keep both open.`,
    uploadsPaused: 'Uploads are paused for today. Sending directly still works — keep both devices open.',
    uploadsOffNobody: 'Open Dropzy on the other device first — files go straight to it.',
    busy: 'This network is busy, so we’ve hidden other people’s items. Find one by its code, or start a Private Share.',
    missingKey: 'This link is missing its last part. Ask the sender to copy the whole link again.',
    ended: 'This share has ended and everything in it was deleted.',
    startNew: 'Start a new one',
    wrongCode: 'No room with that code. Check the digits and try again.',
    locked: 'This room is locked. Ask someone inside to unlock it.',
    rateLimited: 'Slow down a little — try again in a minute.',
    atCapacity: (time: string) => `Dropzy is at capacity for today. It’ll be back at ${time}.`,
    tooBigIphone: 'This file is too big to save in this iPhone’s browser. Open the link on a computer.',
    unsaved: (n: number) => `You have ${n} received ${n === 1 ? 'file' : 'files'} you haven’t saved.`,
    deleted: 'Deleted.',
    undo: 'Undo',
    offline: 'Offline — reconnecting…',
    recovered: (n: number) => `Recovered ${n} ${n === 1 ? 'file' : 'files'}`,
    notFound: 'We couldn’t find that share. It may have ended.',
    spaceFull: 'This share is full. Delete a few items first.',
    busyBusyDirect: 'Sending directly is off on busy networks. Start a Private Share instead.',
    declined: 'The other device didn’t have room for that file.',
    generic: 'Something went wrong. Try again.',
  },

  // Busy-network find (§7.1)
  find: {
    label: 'Find by code',
    placeholder: 'e.g. A7KQ',
    button: 'Find',
    notFound: 'No item with that code right now.',
  },

  // Loading pages
  starting: {
    private: 'Starting your private share…',
    room: 'Creating your room…',
    connecting: 'Connecting…',
    failed: 'We couldn’t start that. Check your connection and try again.',
    retry: 'Try again',
  },

  // Join page (§7.3)
  join: {
    title: 'Join a room',
    subtitle: 'Enter the 6-digit code from the person who made it, or a pair code from your other device.',
    digit: (i: number) => `Digit ${i} of 6`,
    button: 'Join',
    joining: 'Joining…',
    orCreate: 'No code? Create a room',
    fileTitle: 'Got a file code?',
    fileHint: 'Enter the 4-character code shown next to a shared file.',
    fileLabel: 'File code',
    filePlaceholder: 'e.g. A7KQ',
    fileButton: 'Get file',
    fileNotFound: 'No file with that code. It may have expired.',
  },

  // Single-file page (§9.4)
  single: {
    title: 'A file for you',
    from: (name: string) => `Shared by ${name}`,
    endsIn: (d: string) => `Available for ${d}`,
    download: 'Download',
    report: 'Report',
    gone: 'This file is no longer available.',
    asking: 'Getting the key from the device that shared it…',
    senderOffline: 'This is a Private Share file. Open that Private Share on the device that shared it, then enter the code again.',
    openShare: `Open ${brand}`,
  },

  // Report dialog (§14.7)
  report: {
    title: 'Report this file',
    reason: 'What’s wrong with it?',
    reasons: {
      illegal: 'Illegal content',
      malware: 'Malware or a scam',
      abuse: 'Harassment or abuse',
      copyright: 'Copyright',
      other: 'Something else',
    },
    note: 'Anything else we should know? (optional)',
    send: 'Send report',
    thanks: 'Thanks. We’ll take a look quickly.',
  },

  // Contact page
  contactForm: {
    message: 'Message',
    email: 'Your email (optional)',
    send: 'Send message',
    thanks: 'Thanks — we’ll get back to you if you left an email.',
  },

  time: {
    justNow: 'just now',
    minAgo: (n: number) => `${n} min ago`,
    hAgo: (n: number) => `${n} h ago`,
    left: (h: number, m: number) => (h > 0 ? `${h} h ${m} min` : `${m} min`),
    lessThanMin: 'less than a minute',
    speed: (mbps: string) => `${mbps} MB/s`,
    eta: (d: string) => `${d} left`,
  },

  toast: {
    linkCopied: 'Link copied',
    codeCopied: 'Code copied',
    textCopied: 'Copied!',
    copyFailed: 'Couldn’t copy. Select the text and copy it yourself.',
    dismiss: 'Dismiss',
  },

  admin: {
    title: 'Admin',
    token: 'Admin token',
    signIn: 'Open',
    usage: 'Today’s usage',
    reports: 'Reports',
    feedback: 'Feedback',
    deleteItem: 'Delete item',
    block24: 'Block 24 h',
    block7d: 'Block 7 days',
    dismiss: 'Dismiss',
    empty: 'Nothing here.',
  },
} as const;

export type Strings = typeof t;

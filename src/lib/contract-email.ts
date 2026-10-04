import { renderEmailHtml } from "./email-layout.js";

type ContractEmailContext = { title: string; eventName: string };

export function renderContractInvitationEmail(contract: ContractEmailContext & { signerName: string }, url: string) {
  const greeting = `Bonjour ${contract.signerName},`;
  const message = `Votre convention « ${contract.title} » pour ${contract.eventName} est prête. Lisez-la puis signez-la en ligne.`;
  const notes = ["Ce lien personnel est valable 30 jours, ne le partagez pas.", "Vous pourrez télécharger votre exemplaire après signature."];
  return {
    subject: "Votre convention de bénévolat à signer",
    text: [greeting, "", message, "", `Lire et signer : ${url}`, "", ...notes].join("\n"),
    html: renderEmailHtml({
      preheader: `${contract.title} · ${contract.eventName}`, eyebrow: contract.eventName, title: "Convention à signer",
      greeting, paragraphs: [message], action: { label: "Lire et signer", url }, notes,
    }),
  };
}

export function renderContractCodeEmail(contract: ContractEmailContext & { documentHash: string }, code: string) {
  const ignore = "Ne communiquez ce code à personne. Si vous n’avez pas demandé à signer, ignorez cet email.";
  return {
    subject: "Code de signature de votre convention",
    text: [`Votre code : ${code}`, "", `Convention : ${contract.title}`, `Événement : ${contract.eventName}`,
      `Empreinte SHA-256 du PDF : ${contract.documentHash}`, "", `Valable 10 minutes. ${ignore}`].join("\n"),
    html: renderEmailHtml({
      preheader: "Valable 10 minutes.", eyebrow: contract.eventName, title: "Code de signature",
      paragraphs: [`Saisissez ce code pour signer « ${contract.title} ».`],
      code: { value: code, caption: "Valable 10 minutes" },
      notes: [`Empreinte SHA-256 du PDF : ${contract.documentHash}`, ignore],
    }),
  };
}

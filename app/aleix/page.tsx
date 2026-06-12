import type { Metadata } from "next";
import { AleixPageAnalytics, AleixTrackedLink } from "@/components/AleixAnalytics";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Aleix Ordeig Bros in SF | YC OS",
  description: "About Aleix Ordeig Bros, the builder in SF behind YC OS."
};

const links = [
  { label: "LinkedIn", href: "https://www.linkedin.com/in/aleix-ordeig/" },
  { label: "X", href: "https://x.com/heyalerio" },
  { label: "GitHub", href: "https://github.com/aleishio/matchbookhq" },
  { label: "Loom", href: "https://www.loom.com/share/fcccc33cd9df4efb93a204a13acf0ed7" },
  { label: "Resume", href: "#resume" }
];
const loomVideo = {
  href: "https://www.loom.com/share/fcccc33cd9df4efb93a204a13acf0ed7",
  imageSrc: "/aleix/aleix-yc-team-loom.jpg",
  title: "Aleix - YC Team"
};
const resumeItems = [
  {
    role: "Creai",
    detail: "Built prototypes and solutions for enterprise customers, turning real needs into agents that solve the problem."
  },
  {
    role: "Latitud",
    detail: "Created Harbor OS for the founder and angel community, covering applications, CRM, emails, automations, notes, follow-ups, and events."
  },
  {
    role: "Gen Z Fellowship",
    detail: "Ran founder programs and created the context for young builders to meet, learn, and start."
  },
  {
    role: "Kairos / Sigma Squared",
    detail: "Part of the young builder network and community around ambitious early founders."
  },
  {
    role: "Founder",
    detail: "Dropped out at 19, started two early companies, and learned most founder mistakes the hard way."
  },
  {
    role: "Founder tech stack",
    detail: "Helped founders move from no-code automation into APIs, OpenClaw, AI agents, and full-code AI workflows."
  }
];

const sideProjects = [
  { label: "venturecapitalarchive.com", href: "https://venturecapitalarchive.com/" },
  { label: "notasalud.com", href: "https://notasalud.com" },
  { label: "eligeia.com", href: "https://eligeia.com" },
  { label: "justoia.com", note: "offline" },
  { label: "memesio.com", href: "https://memesio.com" },
  { label: "easyandlogic.com", note: "offline" }
];

const references = [
  {
    label: "Gina Gotthilf",
    href: "https://www.linkedin.com/in/ginafrombrazil/",
    detail: "Founder, Outsmart"
  },
  {
    label: "Tomi Roggio",
    href: "https://uy.linkedin.com/in/tomas-roggio",
    detail: "Partner, Latitud"
  },
  {
    label: "Rolando Matarrita",
    href: "https://cr.linkedin.com/in/rolandomatarrita",
    detail: "CTO, Creai"
  },
  {
    label: "Virginia Campo",
    href: "https://www.linkedin.com/in/virginiacampo",
    detail: "Founder, BreakmarkHR"
  }
];

const faqs = [
  {
    question: "What have you been doing the past two years?",
    answer:
      "In 2025 I took a career break to focus on family and health. I ended up driving from Spain to Central Asia, going deep on AI, helping friends with their tech stacks, and trying different agent and automation setups. Now I am in SF, coming back with fresh energy, and ready to support founders again."
  },
  {
    question: "How do you build?",
    answer:
      "I like The Mom Test, talking to users, and getting to the real problem fast. Ship the simplest thing, put it in front of people, learn, and improve. I like owning the project from 0 to 100 and being responsible for the outcome."
  },
  {
    question: "Why this kind of work?",
    answer:
      "The work sits between community taste and product engineering. But taste is not a moat against AI. It is compressed judgment from exposure: see enough examples, classify enough good and bad, and instinct can become a training set."
  },
  {
    question: "How do you decide what should be automated?",
    answer:
      "I automate context gathering, reminders, notes, and workflows first. Judgment work still needs an owner, but the judgment should be captured as examples, labels, meetings, and outcomes so software can keep improving the suggestions."
  }
];

export default function AleixPage() {
  return (
    <main className="app-shell aleix-page">
      <AleixPageAnalytics sectionCount={8} />
      <SiteHeader active="aleix" />

      <section className="aleix-shell" aria-label="About Aleix">
        <section className="aleix-profile">
          <div className="aleix-heading">
            <div className="label">About Aleix in SF</div>
            <h1>Aleix Ordeig Bros in SF</h1>
            <p>
              Spanish-Mexican builder, ex-founder, and founding team member at
              Latitud and Creai. I have worked across founder communities,
              fellowships, automations, and events, and now build agents for
              companies.
            </p>
            <div className="aleix-link-row" aria-label="Aleix links">
              {links.map((link) => (
                <AleixTrackedLink
                  href={link.href}
                  key={link.label}
                  label={link.label}
                  linkType={link.label === "Resume" ? "resume" : link.label === "Loom" ? "video" : "social"}
                >
                  {link.label}
                </AleixTrackedLink>
              ))}
              <AleixTrackedLink href="/" label="YC OS" linkType="demo">YC OS</AleixTrackedLink>
            </div>
          </div>
        </section>

        <section className="aleix-grid">
          <article className="aleix-main">
            <section className="section">
              <div className="label">Loom</div>
              <AleixTrackedLink
                className="aleix-loom-card"
                href={loomVideo.href}
                label="Aleix YC Team Loom"
                linkType="video"
              >
                <span className="aleix-loom-media">
                  <img
                    alt="Loom preview of Aleix explaining why he wants to join the YC team."
                    src={loomVideo.imageSrc}
                  />
                  <span className="aleix-loom-play" aria-hidden="true" />
                </span>
                <span className="aleix-loom-copy">
                  <strong>{loomVideo.title}</strong>
                  <span>Short Loom about why I want to work with YC founders.</span>
                </span>
              </AleixTrackedLink>
            </section>

            <section className="section">
              <div className="label">Latitud</div>
              <p>
                I worked on the founder and angel communities: applications,
                automations, emails, CRMs, follow-ups, notes, happy hours, founder
                events, VLS, and conferences.
              </p>
              <p>
                The best part was meeting founders one by one, understanding their
                problems, and creating intros or relationships that actually helped.
              </p>
            </section>

            <section className="section">
              <div className="label">Creai</div>
              <p>
                At Creai, I build prototypes and solutions for enterprise
                customers. The work starts by understanding what they actually
                need, then turning that into an agent that solves the problem.
              </p>
            </section>

            <section className="section">
              <div className="label">Why YC</div>
              <p>
                It feels like the natural progression. I have spent years building
                for founders, and with AI I can finally ship all of these tools
                and systems that I thought about for the past years.
              </p>
              <p>
                YC is the frontier for community software and the future of technology. More importantly, I like
                seeing founders win. Being part of that journey makes me happy.
              </p>
            </section>

            <section className="section" id="resume">
              <div className="label">Resume</div>
              <div className="aleix-note-list">
                {resumeItems.map((item) => (
                  <div className="note-row" key={item.role}>
                    <span className="note-source">{item.role}</span>
                    <div className="note-text">{item.detail}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="section">
              <div className="label">Side projects</div>
              <div className="aleix-fit">
                {sideProjects.map((project) =>
                  project.href ? (
                    <AleixTrackedLink href={project.href} key={project.label} label={project.label} linkType="project">
                      {project.label}
                    </AleixTrackedLink>
                  ) : (
                    <span key={project.label}>
                      {project.label} ({project.note})
                    </span>
                  )
                )}
              </div>
            </section>

            <section className="section">
              <div className="label">FAQ</div>
              <div className="aleix-faq-list">
                {faqs.map((faq) => (
                  <div className="aleix-faq-item" key={faq.question}>
                    <h2>{faq.question}</h2>
                    <p>{faq.answer}</p>
                  </div>
                ))}
              </div>
            </section>

          </article>

          <aside className="aleix-sidebar" aria-label="Aleix context">
            <section className="section aleix-side-section">
              <div className="label">Values</div>
              <ul className="aleix-signal-list">
                <li>Pay it forward.</li>
                <li>Find the real problem.</li>
                <li>Build the useful thing.</li>
                <li>Make founder life less lonely.</li>
              </ul>
            </section>

            <section className="section aleix-side-section">
              <div className="label">Fun facts</div>
              <ul className="aleix-signal-list">
                <li>A dictator once tried to buy my company. I said no.</li>
                <li>Last year I drove from Spain to Central Asia in a red 1991 Citroen AX.</li>
              </ul>
            </section>

            <section className="section aleix-side-section">
              <div className="label">References</div>
              <div className="aleix-reference-list">
                {references.map((reference) => (
                  <AleixTrackedLink href={reference.href} key={reference.label} label={reference.label} linkType="reference">
                    <strong>{reference.label}</strong>
                    <span>{reference.detail}</span>
                  </AleixTrackedLink>
                ))}
              </div>
            </section>

            <section className="section aleix-side-section">
              <div className="label">Outside work</div>
              <p>
                Books, long walks with my dog Ginebra, cycling, freediving, debates.
              </p>
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}

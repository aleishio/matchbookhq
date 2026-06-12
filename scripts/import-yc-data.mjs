#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const repoRoot = process.cwd();
const sourceDir = process.argv[2] || process.env.YC_EXTRACT_OUTPUT_DIR;
if (!sourceDir) {
  console.error("Usage: node scripts/import-yc-data.mjs /path/to/yc_extract/output");
  console.error("Or set YC_EXTRACT_OUTPUT_DIR to the public YC extract output directory.");
  process.exit(1);
}

const dataDir = join(repoRoot, "data");
const publicAssetRoot = join(repoRoot, "public", "founders", "winter-2026");
const sourceFullPath = join(sourceDir, "winter_2026_full.json");
const sourcePublicEnrichmentPath = join(sourceDir, "winter_2026_public_enrichment_full.json");
const manifestSourceDir = "yc_extract/output";

const importedAt = "2026-06-09T06:36:02.000Z";
const eventId = "yc-w26-event-prep";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactList(values) {
  return values.map(clean).filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sentenceCase(value) {
  const text = clean(value);
  if (!text) return null;
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function splitPipe(value) {
  return compactList(String(value || "").split("|"));
}

function firstParagraph(value) {
  const text = clean(value);
  if (!text) return null;
  return clean(text.split(/\n\s*\n/)[0]);
}

function stripMarkdown(value) {
  return clean(
    String(value || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>#]/g, "")
      .replace(/https?:\/\/\S+/g, "")
  );
}

function firstSentence(value, maxLength = 220) {
  const text = stripMarkdown(value);
  if (!text) return null;
  const match = text.match(/^(.{40,}?[.!?])\s/);
  const sentence = clean(match ? match[1] : text);
  if (!sentence) return null;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1).trim()}...` : sentence;
}

function sourcePathToPublic(localPath) {
  if (!localPath) return null;
  const outputMarker = "yc_extract/output/";
  const relativeSourcePath = localPath.includes(outputMarker)
    ? localPath.slice(localPath.indexOf(outputMarker) + outputMarker.length)
    : localPath;
  const absolute = localPath.startsWith("/") ? localPath : join(sourceDir, relativeSourcePath);
  if (!existsSync(absolute)) return null;
  const parts = localPath.split("/");
  const batchIndex = parts.indexOf("winter_2026");
  if (batchIndex < 0 || batchIndex + 2 >= parts.length) return null;
  const companySlug = parts[batchIndex + 1];
  const fileName = parts[batchIndex + 2];
  const destination = join(publicAssetRoot, companySlug, fileName);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(absolute, destination);
  return `/${relative(join(repoRoot, "public"), destination).replaceAll("\\", "/")}`;
}

function buildAssetIndexes(assets) {
  const byFounderId = new Map();
  const companyLogoById = new Map();
  const companySmallLogoById = new Map();
  const copiedAssets = [];

  for (const asset of assets) {
    if (asset.download_error || !asset.local_path) continue;
    const publicPath = sourcePathToPublic(asset.local_path);
    if (!publicPath) continue;
    copiedAssets.push({
      source_path: asset.local_path,
      public_path: publicPath,
      asset_type: asset.asset_type,
      bytes: asset.bytes ?? null,
      sha256: asset.sha256 ?? null,
    });

    if (asset.asset_type === "founder_avatar" && asset.founder_user_id) {
      byFounderId.set(String(asset.founder_user_id), publicPath);
    }
    if (asset.asset_type === "company_logo" && asset.company_id) {
      companyLogoById.set(String(asset.company_id), publicPath);
    }
    if (asset.asset_type === "company_small_logo" && asset.company_id) {
      companySmallLogoById.set(String(asset.company_id), publicPath);
    }
  }

  return { byFounderId, companyLogoById, companySmallLogoById, copiedAssets };
}

function categoryFor(company) {
  return clean(company.subindustry) || clean(company.industry) || "Uncategorized";
}

function stageFor(company) {
  return clean(company.stage) || "Early";
}

function deriveNeed(company, launchByCompanyId) {
  const launch = launchByCompanyId.get(String(company.id));
  const launchBody = launch?.body || launch?.tagline || "";
  const askMatch = launchBody.match(/(?:our\s+ask|ask)\s*:?\s*([\s\S]{0,420})/i);
  if (askMatch) {
    const ask = firstSentence(askMatch[1]);
    if (ask) {
      return {
        need_text: ask,
        need_category: "launch_feedback",
        source: "yc_launch_ask",
        source_url: launch.source_launch_url || launch.search_path || null,
      };
    }
  }

  const publicJobs = Array.isArray(company.job_postings) ? company.job_postings : [];
  if (publicJobs.length > 0) {
    const roles = [...new Set(publicJobs.map((job) => clean(job.prettyRole || job.title)).filter(Boolean))].slice(0, 3);
    return {
      need_text: `Hiring help: ${roles.join(", ")} candidates for ${company.name}.`,
      need_category: "hiring",
      source: "yc_public_jobs",
      source_url: company.jobs_url || company.ycdc_url || null,
    };
  }

  const description = firstParagraph(company.long_description) || company.one_liner;
  const lower = `${company.one_liner || ""} ${company.long_description || ""}`.toLowerCase();
  if (lower.includes("api") || lower.includes("developer") || lower.includes("infrastructure")) {
    return {
      need_text: `Find technical design partners who can pressure-test ${company.name}'s developer workflow.`,
      need_category: "design_partners",
      source: "derived_from_public_profile",
      source_url: company.ycdc_url || null,
    };
  }
  if (lower.includes("sales") || lower.includes("outbound") || lower.includes("gtm")) {
    return {
      need_text: `Meet founders and sales leaders who can compare notes on GTM motion for ${company.name}.`,
      need_category: "gtm",
      source: "derived_from_public_profile",
      source_url: company.ycdc_url || null,
    };
  }
  if (lower.includes("health") || lower.includes("clinic") || lower.includes("patient")) {
    return {
      need_text: `Meet operators with healthcare workflow context for ${company.name}.`,
      need_category: "customer_discovery",
      source: "derived_from_public_profile",
      source_url: company.ycdc_url || null,
    };
  }

  return {
    need_text: `Meet relevant founders and early customers for: ${firstSentence(description || company.one_liner, 180) || company.name}.`,
    need_category: "customer_discovery",
    source: "derived_from_public_profile",
    source_url: company.ycdc_url || null,
  };
}

function noteBodyForFounder(founder, company, noteType) {
  if (noteType === "office_hours") {
    return `${company.name}: ${firstSentence(company.one_liner || company.long_description, 180) || "public YC company profile available"}.`;
  }
  if (noteType === "other_founder") {
    const bio = firstSentence(founder.founder_bio, 180);
    return bio ? `${founder.full_name}: ${bio}` : `${founder.full_name} is listed as ${founder.title || "Founder"} at ${company.name}.`;
  }
  const partner = company.primary_group_partner?.full_name;
  const location = clean(company.location) || "location not listed";
  return `${company.batch || "W26"} room context: ${categoryFor(company)} company in ${location}${partner ? `, group partner ${partner}` : ""}.`;
}

function main() {
  const source = readJson(sourceFullPath);
  const enrichment = existsSync(sourcePublicEnrichmentPath) ? readJson(sourcePublicEnrichmentPath) : {};
  const { byFounderId, companyLogoById, companySmallLogoById, copiedAssets } = buildAssetIndexes(source.assets || []);
  const founderSourceIdCounts = new Map();
  for (const company of source.companies || []) {
    for (const founder of company.founders || []) {
      const sourceId = String(founder.user_id);
      founderSourceIdCounts.set(sourceId, (founderSourceIdCounts.get(sourceId) || 0) + 1);
    }
  }

  const launchRecords = enrichment.launches?.records || enrichment.launches?.list_records || [];
  const launchByCompanyId = new Map();
  for (const launch of launchRecords) {
    const companyId = launch.company_id || launch.company?.id;
    if (companyId && !launchByCompanyId.has(String(companyId))) {
      launchByCompanyId.set(String(companyId), launch);
    }
  }

  const event = {
    id: eventId,
    title: "YC Winter 2026 Event Prep",
    location: "San Francisco",
    starts_at: "2026-06-09T18:00:00.000Z",
    attendee_count: 0,
    source: {
      kind: "public_seed",
      source_url: source.source?.directory_url || "https://www.ycombinator.com/companies?batch=Winter%202026",
      retrieved_at: source.extracted_at,
      imported_at: importedAt,
    },
  };

  const companies = [];
  const founders = [];
  const attendance = [];
  const founderNeeds = [];
  const notes = [];

  for (const company of [...source.companies].sort((a, b) => a.name.localeCompare(b.name))) {
    const companyId = `company_${company.id}`;
    const need = deriveNeed(company, launchByCompanyId);
    const companyFounders = [...(company.founders || [])].sort((a, b) => a.full_name.localeCompare(b.full_name));

    companies.push({
      id: companyId,
      source_id: String(company.id),
      name: company.name,
      slug: company.slug,
      batch: company.batch || "W26",
      stage: stageFor(company),
      category: categoryFor(company),
      industry: clean(company.industry),
      subindustry: clean(company.subindustry),
      one_liner: clean(company.one_liner),
      long_description: clean(company.long_description),
      website: clean(company.website),
      yc_url: clean(company.ycdc_url),
      location: clean(company.location),
      city: clean(company.city),
      country: clean(company.country),
      team_size: company.team_size ?? null,
      year_founded: company.year_founded ?? null,
      is_hiring: Boolean(company.isHiring),
      top_company: Boolean(company.top_company),
      tags: company.tags || [],
      regions: splitPipe(Array.isArray(company.regions) ? company.regions.join(" | ") : company.regions),
      primary_group_partner: company.primary_group_partner
        ? {
            id: String(company.primary_group_partner.id),
            name: clean(company.primary_group_partner.full_name),
            url: clean(company.primary_group_partner.url),
          }
        : null,
      social_links: {
        linkedin: clean(company.linkedin_url),
        twitter: clean(company.twitter_url),
        github: clean(company.github_url),
        crunchbase: clean(company.cb_url),
      },
      image_paths: {
        logo: companyLogoById.get(String(company.id)) || null,
        small_logo: companySmallLogoById.get(String(company.id)) || null,
        source_logo_url: clean(company.logo_url),
        source_small_logo_url: clean(company.small_logo_url),
      },
      public_counts: {
        founder_count: companyFounders.length,
        job_postings_count: Array.isArray(company.job_postings) ? company.job_postings.length : 0,
        launches_count: Array.isArray(company.launches) ? company.launches.length : 0,
      },
    });

    for (const founder of companyFounders) {
      const founderSourceId = String(founder.user_id);
      const founderId =
        founderSourceIdCounts.get(founderSourceId) > 1
          ? `founder_${founderSourceId}_company_${company.id}`
          : `founder_${founderSourceId}`;
      const photoPath = byFounderId.get(String(founder.user_id)) || null;
      founders.push({
        id: founderId,
        source_id: founderSourceId,
        name: founder.full_name,
        company_id: companyId,
        role: clean(founder.title) || "Founder",
        location: clean(company.location),
        bio: clean(founder.founder_bio),
        is_active: Boolean(founder.is_active),
        has_public_email_flag: Boolean(founder.has_email),
        social_links: {
          linkedin: clean(founder.linkedin_url),
          twitter: clean(founder.twitter_url),
          yc_company: clean(founder.latest_yc_company?.href),
        },
        image_paths: {
          photo: photoPath,
          source_photo_url: clean(founder.avatar_thumb_url),
          initials_fallback: founder.full_name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join(""),
        },
      });

      attendance.push({
        id: `${eventId}_${founderId}`,
        event_id: eventId,
        founder_id: founderId,
        status: founder.is_active ? "attending" : "listed",
        source: "yc_w26_public_batch_import",
      });

      founderNeeds.push({
        id: `need_${founderId}`,
        founder_id: founderId,
        company_id: companyId,
        need_text: sentenceCase(need.need_text),
        need_category: need.need_category,
        source: need.source,
        source_url: need.source_url,
        updated_at: importedAt,
      });

      for (const noteType of ["office_hours", "other_founder", "room"]) {
        notes.push({
          id: `note_${founderId}_${noteType}`,
          founder_id: founderId,
          note_type: noteType,
          body: noteBodyForFounder(founder, company, noteType),
          source: "generated_from_public_yc_profile",
          source_url: company.ycdc_url || null,
          created_at: importedAt,
        });
      }
    }
  }

  event.attendee_count = attendance.length;

  const manifest = {
    import_name: "yc_winter_2026_event_prep_seed",
    import_version: "v1",
    imported_at: importedAt,
    source_dir: manifestSourceDir,
    sources: [
      {
        name: "winter_2026_full.json",
        path: `${manifestSourceDir}/winter_2026_full.json`,
        source_url: source.source?.directory_url || null,
        retrieved_at: source.extracted_at,
      },
      {
        name: "winter_2026_public_enrichment_full.json",
        path: `${manifestSourceDir}/winter_2026_public_enrichment_full.json`,
        source_url: "https://www.ycombinator.com/launches",
        retrieved_at: enrichment.extracted_at || null,
      },
    ],
    counts: {
      events: 1,
      companies: companies.length,
      founders: founders.length,
      attendance: attendance.length,
      founder_needs: founderNeeds.length,
      notes: notes.length,
      copied_assets: copiedAssets.length,
      founders_with_local_photo: founders.filter((founder) => founder.image_paths.photo).length,
      founders_missing_local_photo: founders.filter((founder) => !founder.image_paths.photo).length,
    },
    privacy: "All records are generated from public YC profile, launch, jobs, and public enrichment data. Notes are public-derived seed context, not private notes.",
  };

  mkdirSync(dataDir, { recursive: true });
  writeJson(join(dataDir, "events.json"), [event]);
  writeJson(join(dataDir, "companies.json"), companies);
  writeJson(join(dataDir, "founders.json"), founders);
  writeJson(join(dataDir, "attendance.json"), attendance);
  writeJson(join(dataDir, "founder-needs.json"), founderNeeds);
  writeJson(join(dataDir, "notes.json"), notes);
  writeJson(join(dataDir, "assets.json"), copiedAssets);
  writeJson(join(dataDir, "seed.json"), {
    manifest,
    events: [event],
    companies,
    founders,
    attendance,
    founder_needs: founderNeeds,
    notes,
  });
  writeJson(join(dataDir, "import-manifest.json"), manifest);

  console.log(JSON.stringify(manifest.counts, null, 2));
}

main();

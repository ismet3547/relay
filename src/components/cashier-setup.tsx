"use client";
import { useState } from "react";
import { ArrowRight, Check, Loader2, Save, Utensils } from "lucide-react";
import { CashierController } from "@/hooks/use-cashier";
import { CashierJob, cashierTools, defaultCashierModel } from "@/lib/cashier";

function JobForm({
  cashier,
  onMenu,
}: {
  cashier: CashierController;
  onMenu: () => void;
}) {
  const [job, setJob] = useState<CashierJob>(() =>
    structuredClone(cashier.overview!.job),
  );
  const [saved, setSaved] = useState(false);
  function edit(patch: Partial<CashierJob>) {
    setJob((previous) => ({ ...previous, ...patch }));
    setSaved(false);
  }
  async function save() {
    const next = await cashier.saveJob(job);
    if (next) {
      setJob(structuredClone(next.job));
      setSaved(true);
    }
  }
  return (
    <form
      className="panel cashier-form cashier-job-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="panel-heading">
        <div>
          <h2>Cashier job configuration</h2>
          <p>Saved settings apply when a new ordering session starts.</p>
        </div>
        <button
          type="submit"
          className="button primary"
          disabled={cashier.busy}
        >
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saved ? "Saved" : "Save job"}
        </button>
      </div>
      <div className="cashier-form-body">
        <div className="cashier-form-grid">
          <label>
            Agent name
            <input
              required
              maxLength={100}
              value={job.agentName}
              onChange={(e) => edit({ agentName: e.target.value })}
            />
          </label>
          <label>
            Job name
            <input
              required
              maxLength={100}
              value={job.jobName}
              onChange={(e) => edit({ jobName: e.target.value })}
            />
          </label>
          <label>
            Business name
            <input
              required
              maxLength={100}
              value={job.businessName}
              onChange={(e) => edit({ businessName: e.target.value })}
            />
          </label>
          <label>
            Primary language
            <select
              value={job.primaryLanguage}
              onChange={(e) =>
                edit({ primaryLanguage: e.target.value as "en" | "tr" })
              }
            >
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </label>
        </div>
        <label>
          Business description
          <textarea
            rows={2}
            maxLength={500}
            value={job.businessDescription}
            onChange={(e) => edit({ businessDescription: e.target.value })}
          />
        </label>
        <label>
          Greeting
          <textarea
            required
            rows={2}
            maxLength={500}
            value={job.greeting}
            onChange={(e) => edit({ greeting: e.target.value })}
          />
        </label>
        <label>
          Job instructions
          <textarea
            required
            className="cashier-instructions"
            rows={5}
            maxLength={3000}
            value={job.instructions}
            onChange={(e) => edit({ instructions: e.target.value })}
          />
          <small>
            Describe tone and service behavior. Instructions cannot add tools,
            choose prices, bypass confirmation, or expand permissions.
          </small>
        </label>
        <div className="cashier-editor-section">
          <div>
            <h3>Operational rules</h3>
            <p>Backend-enforced rules for each new session.</p>
          </div>
        </div>
        <div className="cashier-form-grid">
          <label>
            Tax rate (%)
            <input
              type="number"
              min={0}
              max={25}
              step={0.01}
              required
              value={job.taxBasisPoints / 100}
              onChange={(e) =>
                edit({
                  taxBasisPoints: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
          <label>
            Maximum items per order
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              required
              value={job.maxCartItems}
              onChange={(e) => edit({ maxCartItems: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="cashier-fulfillment-rules">
          <span className="eyebrow">FULFILLMENT</span>
          {(["pickup", "dine_in"] as const).map((type) => (
            <label className="cashier-checkbox" key={type}>
              <input
                type="checkbox"
                checked={job.fulfillmentTypes.includes(type)}
                disabled={
                  job.fulfillmentTypes.length === 1 &&
                  job.fulfillmentTypes.includes(type)
                }
                onChange={(e) =>
                  edit({
                    fulfillmentTypes: e.target.checked
                      ? [...job.fulfillmentTypes, type]
                      : job.fulfillmentTypes.filter((f) => f !== type),
                  })
                }
              />
              {type === "pickup" ? "Pickup" : "Dine in"}
            </label>
          ))}
        </div>
        <div className="cashier-editor-section">
          <div>
            <h3>Approved tools</h3>
            <p>
              Only these registered operations can run. Menu and cart reads are
              required.
            </p>
          </div>
        </div>
        <div className="cashier-tool-permissions">
          {cashierTools.map((tool) => (
            <label className="cashier-checkbox" key={tool}>
              <input
                type="checkbox"
                checked={job.enabledTools.includes(tool)}
                disabled={["get_menu", "get_cart"].includes(tool)}
                onChange={(e) =>
                  edit({
                    enabledTools: e.target.checked
                      ? [...job.enabledTools, tool]
                      : job.enabledTools.filter((t) => t !== tool),
                  })
                }
              />
              <span>{tool.replaceAll("_", " ")}</span>
            </label>
          ))}
        </div>
        <div className="cashier-menu-link">
          <div>
            <strong>Available menu</strong>
            <p>
              {cashier.overview!.products.length} stored products · shared with
              the cashier
            </p>
          </div>
          <button type="button" className="text-button" onClick={onMenu}>
            Edit in Operations
            <ArrowRight size={14} />
          </button>
        </div>
        <p className="cashier-footnote">
          Job version {job.version} · USD · unpaid, pay at counter. Current
          sessions retain the settings they started with.
        </p>
      </div>
    </form>
  );
}
export function CashierSetup({
  cashier,
  onMenu,
}: {
  cashier: CashierController;
  onMenu: () => void;
}) {
  if (!cashier.overview)
    return (
      <div className="loading-workspace">
        <Loader2 className="spin" size={24} />
        <p>Loading agent configuration…</p>
      </div>
    );
  return (
    <div className="cashier-feature cashier-setup-grid">
      <aside>
        <div className="panel cashier-job-selected">
          <span className="cashier-welcome-icon">
            <Utensils size={28} />
          </span>
          <span className="eyebrow">SELECTED AI JOB</span>
          <h2>Fast-Food Cashier</h2>
          <p>Menu → conversation → cart → confirmed order → local Kitchen.</p>
          <span className="cashier-badge">Implemented job · v1</span>
        </div>
        <div className="panel cashier-provider">
          <h3>Local language model</h3>
          <strong>
            {cashier.health?.agent.model || "Checking configuration…"}
          </strong>
          <p>
            {cashier.health?.agent.ready
              ? "Ollama is reachable and the model supports tools."
              : cashier.health?.agent.error || "Checking the actual service…"}
          </p>
          <code>
            ollama pull {cashier.health?.agent.model || defaultCashierModel}
          </code>
          <button
            className="button secondary"
            onClick={() => cashier.checkHealth()}
          >
            Check setup
            <ArrowRight size={14} />
          </button>
          <p>
            Change provider endpoint and model through the server environment.
            Restart Relay after changing them.
          </p>
        </div>
      </aside>
      <JobForm cashier={cashier} onMenu={onMenu} />
    </div>
  );
}

// Bootstrap: importing a worker module registers it (each calls
// zeebeClient.createWorker() at module load). Add new workers here as
// they're scaffolded via /new-job-worker.
import "./validate-claim";
import "./extract-evidence";
import "./detect-fraud-indicators";
import "./score-risk";
import "./capture-routing-decision";
import "./capture-triage-review";
import "./capture-review-decision";
import "./capture-signoff";
import "./capture-validation-exception";
import "./trigger-settlement";
import "./draft-denial-letter";
import "./notify-claimant";
import "./close-case";

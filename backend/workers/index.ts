// Bootstrap: importing a worker module registers it (each calls
// zeebeClient.createWorker() at module load). Add new workers here as
// they're scaffolded via /new-job-worker.
import "./validate-claim";
import "./extract-evidence";
import "./detect-fraud-indicators";

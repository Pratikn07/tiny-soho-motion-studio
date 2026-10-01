import sys
from pathlib import Path
from unittest.mock import Mock
import httpx
import pytest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'creative-vision'));sys.path.insert(0,str(ROOT))
from src.repository import SupabaseVisionRepository, VisionRepositoryError
from src.config import HostedVisionConfig

def test_network_disconnect_becomes_recoverable_repository_error():
    client=Mock()
    client.request.side_effect=[httpx.RemoteProtocolError('connection lost'),httpx.Response(200,json=[])]
    repository=SupabaseVisionRepository(HostedVisionConfig('https://storage.example','test-only',1),client)
    with pytest.raises(VisionRepositoryError): repository.claim_vision_job()
    assert repository.claim_vision_job() is None

def test_long_composition_extends_only_its_owned_lease():
    from src.processor import VisionJob
    client=Mock();client.request.return_value=httpx.Response(200,json=[{'id':'job'}])
    repository=SupabaseVisionRepository(HostedVisionConfig('https://storage.example','test-only',1),client)
    job=VisionJob('job','owner','project','source','compose',{},[],worker_lease_id='lease')
    repository.extend_job_lease(job)
    assert client.request.call_args.kwargs['params']['worker_lease_id']=='eq.lease'
    assert client.request.call_args.kwargs['params']['owner_user_id']=='eq.owner'
    client.request.return_value=httpx.Response(200,json=[])
    with pytest.raises(VisionRepositoryError): repository.extend_job_lease(job)

def test_processing_renews_lease_periodically_and_stops_renewing_after_finish(monkeypatch):
    import threading
    from src import main
    from src.processor import VisionJob
    job = VisionJob('job','owner','project','source','compose',{},[],worker_lease_id='lease')
    repo = Mock(); repo.claim_vision_job.return_value = job
    renewed = threading.Event()
    count = 0
    def renew(_):
        nonlocal count
        count += 1
        if count >= 3: renewed.set()
    repo.extend_job_lease.side_effect = renew
    def process(*_):
        assert renewed.wait(1), 'lease did not renew during composition'
        return Mock(status='completed',asset_ids=['out'],error_code=None,error_message=None)
    monkeypatch.setattr(main,'LEASE_RENEW_SECONDS',0.01)
    monkeypatch.setattr(main,'process_vision_job',process)
    assert main.claim_and_process_once(repo,Mock())
    repo.complete_job.assert_called_once()
    assert not any(t.name == 'vision-job-lease' for t in threading.enumerate())

def test_lost_lease_cannot_upload_or_complete():
    from src.processor import VisionJob
    client=Mock(); client.request.return_value=httpx.Response(200,json=[])
    repo=SupabaseVisionRepository(HostedVisionConfig('https://storage.example','test-only',1),client)
    job=VisionJob('job','owner','project','source','compose',{},[],worker_lease_id='old')
    with pytest.raises(VisionRepositoryError):
        repo.upload_derived(job,'out.mp4',b'video','video/mp4','derived_video')
    assert client.request.call_count == 1
    assert client.request.call_args.args[0] == 'PATCH'
    with pytest.raises(VisionRepositoryError):
        repo.complete_job(job,status='completed',asset_ids=['out'],error_code=None,error_message=None)

def test_retried_job_reuses_its_own_partial_upload():
    from src.processor import VisionJob
    from src.repository import JobStorage
    path = 'owners/owner/projects/project/vision/job/composed.mp4'
    calls = []
    def respond(method, url, **kwargs):
        calls.append((method, url, kwargs.get('headers', {})))
        if method == 'PATCH':
            return httpx.Response(200, json=[{'id': 'job'}])
        if '/storage/v1/object/' in url:
            return httpx.Response(200, json={'Key': path})
        if method == 'POST':
            return httpx.Response(409, json={'code': '23505', 'message': 'duplicate key value'})
        return httpx.Response(200, json=[{'id': 'asset-from-first-attempt'}])
    client = Mock(); client.request.side_effect = respond
    repo = SupabaseVisionRepository(HostedVisionConfig('https://storage.example', 'test-only', 1), client)
    job = VisionJob('job', 'owner', 'project', 'source', 'compose', {}, [], worker_lease_id='lease')
    assert JobStorage(repo, job).upload_derived(path, b'video', 'video/mp4', 'derived-video') == 'asset-from-first-attempt'
    upload = next(call for call in calls if '/storage/v1/object/' in call[1])
    assert upload[2]['x-upsert'] == 'true'
    with pytest.raises(VisionRepositoryError):
        JobStorage(repo, job).upload_derived('owners/owner/projects/project/vision/other-job/x.mp4', b'v', 'video/mp4', 'derived-video')

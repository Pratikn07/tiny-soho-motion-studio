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

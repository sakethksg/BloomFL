source /home/saketh/BloomFL/venv/bin/activate && cd /home/saketh/BloomFL/frontend && npm run dev

cd /home/saketh/BloomFL && source venv/bin/activate && uvicorn api.main:app --reload --host 0.0.0.0 --port 8000 --log-level info

python scripts/seed_fake_data.py --rounds 20 --nodes 3 --clear